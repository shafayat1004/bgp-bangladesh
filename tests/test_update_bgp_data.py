import collections
import json
import os
import sys
import types
import unittest
from unittest import mock


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import scripts.update_bgp_data as ubd  # noqa: E402
from scripts.update_bgp_data import (  # noqa: E402
    _process_single_route,
    analyze_routes,
    build_viz_data,
    classify_tentative_iig_type,
    discover_latest_rib_dumps,
    get_country_resources_from_rir_stats,
    get_with_retries,
    ipv4_range_to_prefixes,
    mrt_elem_to_route,
    probe_bgp_state_health,
    _snapshot_filename,
    _parse_snapshot_ts,
    archive_snapshot,
    prune_history,
    write_history_index,
)


class _FakeResponse:
    """Minimal stand-in for a requests.Response."""

    def __init__(self, status_code=200, headers=None, json_data=None, text="",
                 url="http://example/test"):
        self.status_code = status_code
        self.headers = headers or {}
        self._json = json_data
        self.text = text
        self.url = url

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(f"{self.status_code} for {self.url}")


class TestClassifyTentativeIIGType(unittest.TestCase):
    def test_licensed_asn_stays_iig(self):
        result = classify_tentative_iig_type(
            asn="100",
            is_bd_registered=True,
            geo_country="BD",
            btrc_licensed_asns={"100"},
            iigs_with_domestic=set(),
            direct_peers_map={},
        )
        self.assertEqual(result, "iig")

    def test_offshore_without_domestic_is_enterprise(self):
        result = classify_tentative_iig_type(
            asn="200",
            is_bd_registered=True,
            geo_country="SG",
            btrc_licensed_asns=set(),
            iigs_with_domestic=set(),
            direct_peers_map={"200": ["174"]},
        )
        self.assertEqual(result, "offshore-enterprise")

    def test_offshore_with_domestic_is_gateway(self):
        result = classify_tentative_iig_type(
            asn="201",
            is_bd_registered=True,
            geo_country="SG",
            btrc_licensed_asns=set(),
            iigs_with_domestic={"201"},
            direct_peers_map={},
        )
        self.assertEqual(result, "offshore-gateway")

    def test_domestic_customer_evidence_is_detected_iig(self):
        result = classify_tentative_iig_type(
            asn="300",
            is_bd_registered=True,
            geo_country="BD",
            btrc_licensed_asns=set(),
            iigs_with_domestic={"300"},
            direct_peers_map={},
        )
        self.assertEqual(result, "detected-iig")

    def test_direct_international_peer_is_detected_iig(self):
        result = classify_tentative_iig_type(
            asn="45273",
            is_bd_registered=True,
            geo_country="BD",
            btrc_licensed_asns=set(),
            iigs_with_domestic=set(),
            direct_peers_map={"45273": ["174", "3491"]},
        )
        self.assertEqual(result, "detected-iig")

    def test_non_gateway_becomes_local_company(self):
        result = classify_tentative_iig_type(
            asn="999",
            is_bd_registered=True,
            geo_country="BD",
            btrc_licensed_asns=set(),
            iigs_with_domestic=set(),
            direct_peers_map={},
        )
        self.assertEqual(result, "local-company")


class TestBuildVizDataClassification(unittest.TestCase):
    def test_build_viz_data_promotes_direct_peers_to_detected_iig(self):
        analysis = {
            "outside_counts": collections.Counter({"174": 18}),
            "iig_counts": collections.Counter({"45273": 10, "200": 8}),
            "local_isp_counts": collections.Counter({"65001": 5}),
            "edge_intl": collections.Counter({
                ("174", "45273"): 10,
                ("174", "200"): 8,
            }),
            "edge_domestic": collections.Counter({
                ("65001", "200"): 5,
            }),
            "direct_peers_map": {
                "45273": ["174"],
                "200": ["174"],
            },
            "valid_obs": 123,
        }
        asn_info = {
            "174": {"name": "Cogent", "holder": "Cogent", "country": "US"},
            "45273": {"name": "Bangla Trac", "holder": "Bangla Trac", "country": "BD", "geo_country": "BD"},
            "200": {
                "name": "Offshore Gateway",
                "holder": "Offshore Gateway",
                "country": "BD",
                "geo_country_data": {"dominant_country": "SG", "breakdown": []},
            },
            "65001": {"name": "LocalCo", "holder": "LocalCo", "country": "BD"},
        }
        country_asns = {"45273", "200", "65001"}

        data = build_viz_data(
            analysis=analysis,
            asn_info=asn_info,
            country_asns=country_asns,
            btrc_licensed_asns=set(),
            peering_locations={},
        )

        nodes = {n["asn"]: n for n in data["nodes"]}
        self.assertEqual(nodes["45273"]["type"], "detected-iig")
        self.assertEqual(nodes["200"]["type"], "offshore-gateway")
        self.assertEqual(nodes["65001"]["type"], "local-company")
        self.assertEqual(nodes["174"]["type"], "outside")

        self.assertEqual(data["stats"]["total_detected_iig"], 1)
        self.assertEqual(data["stats"]["total_offshore_gateway"], 1)
        self.assertEqual(data["stats"]["valid_observations"], 123)


class TestProcessSingleRoute(unittest.TestCase):
    def test_process_single_route_collects_expected_edges(self):
        seen = set()
        outside_counts = collections.Counter()
        iig_counts = collections.Counter()
        local_isp_counts = collections.Counter()
        edge_intl = collections.Counter()
        edge_domestic = collections.Counter()
        direct_peers = collections.Counter()
        country_asns = {"45273", "65001"}
        route = {
            "target_prefix": "1.1.1.0/24",
            "source_id": "rrc00",
            "path": ["174", "45273", "65001"],
        }

        accepted = _process_single_route(
            route,
            country_asns,
            seen,
            outside_counts,
            iig_counts,
            local_isp_counts,
            edge_intl,
            edge_domestic,
            direct_peers,
        )

        self.assertTrue(accepted)
        self.assertEqual(outside_counts["174"], 1)
        self.assertEqual(iig_counts["45273"], 1)
        self.assertEqual(local_isp_counts["65001"], 1)
        self.assertEqual(edge_intl[("174", "45273")], 1)
        self.assertEqual(edge_domestic[("65001", "45273")], 1)
        self.assertEqual(direct_peers[("174", "45273")], 1)
        self.assertEqual(direct_peers[("45273", "65001")], 1)

    def test_process_single_route_deduplicates_by_target_and_source(self):
        seen = set()
        outside_counts = collections.Counter()
        iig_counts = collections.Counter()
        local_isp_counts = collections.Counter()
        edge_intl = collections.Counter()
        edge_domestic = collections.Counter()
        direct_peers = collections.Counter()
        country_asns = {"45273", "65001"}
        route = {
            "target_prefix": "1.1.1.0/24",
            "source_id": "rrc00",
            "path": ["174", "45273", "65001"],
        }

        first = _process_single_route(
            route,
            country_asns,
            seen,
            outside_counts,
            iig_counts,
            local_isp_counts,
            edge_intl,
            edge_domestic,
            direct_peers,
        )
        second = _process_single_route(
            route,
            country_asns,
            seen,
            outside_counts,
            iig_counts,
            local_isp_counts,
            edge_intl,
            edge_domestic,
            direct_peers,
        )

        self.assertTrue(first)
        self.assertFalse(second)
        self.assertEqual(outside_counts["174"], 1)


class TestIpv4RangeToPrefixes(unittest.TestCase):
    def test_summarizes_aligned_range(self):
        self.assertEqual(ipv4_range_to_prefixes("103.0.0.0", 512), ["103.0.0.0/23"])

    def test_single_address(self):
        self.assertEqual(ipv4_range_to_prefixes("1.2.3.4", 1), ["1.2.3.4/32"])

    def test_unaligned_range_splits_into_multiple(self):
        prefixes = ipv4_range_to_prefixes("192.0.2.0", 256 + 128)
        self.assertEqual(prefixes, ["192.0.2.0/24", "192.0.3.0/25"])


class TestRirStatsParsing(unittest.TestCase):
    SAMPLE = "\n".join([
        "2|apnic|20260605|...|...|...|...",   # header-ish line (too few fields after split? has 7) -> skip via status
        "apnic|BD|asn|58717|1|20100101|allocated",
        "apnic|BD|asn|137425|2|20200101|assigned",
        "apnic|BD|ipv4|103.11.136.0|512|20150101|allocated",
        "apnic|BD|ipv6|2400:adc0::|32|20150101|allocated",
        "apnic|IN|asn|9498|1|20000101|allocated",          # wrong country
        "apnic|BD|ipv4|1.2.3.0|256|20150101|reserved",      # wrong status
        "# comment line",
    ])

    def _patched_get(self, *args, **kwargs):
        return _FakeResponse(text=self.SAMPLE)

    def test_parses_bd_resources_only(self):
        with mock.patch.object(ubd, "get_with_retries", side_effect=self._patched_get):
            asns, prefixes = get_country_resources_from_rir_stats("bd")
        self.assertEqual(asns, {"58717", "137425", "137426"})
        self.assertIn("103.11.136.0/23", prefixes)
        self.assertIn("2400:adc0::/32", prefixes)
        # IN asn and reserved ipv4 excluded
        self.assertNotIn("9498", asns)
        self.assertNotIn("1.2.3.0/24", prefixes)

    def test_raises_when_no_resources(self):
        with mock.patch.object(ubd, "get_with_retries",
                               side_effect=lambda *a, **k: _FakeResponse(text="apnic|US|asn|1|1|x|allocated")):
            with self.assertRaises(RuntimeError):
                get_country_resources_from_rir_stats("BD")


class TestGetWithRetries(unittest.TestCase):
    def test_retries_transient_then_succeeds(self):
        responses = [
            _FakeResponse(status_code=503, headers={}),
            _FakeResponse(status_code=200, json_data={"ok": True}),
        ]
        calls = {"n": 0}

        def fake_get(url, params=None, headers=None, timeout=None):
            r = responses[calls["n"]]
            calls["n"] += 1
            return r

        with mock.patch.object(ubd.requests, "get", side_effect=fake_get), \
                mock.patch.object(ubd.time, "sleep") as sleep:
            resp = get_with_retries("http://x", attempts=4)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(calls["n"], 2)
        sleep.assert_called()  # backed off once

    def test_honors_retry_after_header(self):
        responses = [
            _FakeResponse(status_code=429, headers={"Retry-After": "7"}),
            _FakeResponse(status_code=200, json_data={}),
        ]
        calls = {"n": 0}

        def fake_get(url, params=None, headers=None, timeout=None):
            r = responses[calls["n"]]
            calls["n"] += 1
            return r

        with mock.patch.object(ubd.requests, "get", side_effect=fake_get), \
                mock.patch.object(ubd.time, "sleep") as sleep:
            get_with_retries("http://x", attempts=3)
        sleep.assert_called_once_with(7)

    def test_raises_after_exhausting_attempts(self):
        import requests

        with mock.patch.object(ubd.requests, "get",
                               side_effect=requests.ConnectionError("boom")), \
                mock.patch.object(ubd.time, "sleep"):
            with self.assertRaises(requests.RequestException):
                get_with_retries("http://x", attempts=2)


class TestProbeBgpStateHealth(unittest.TestCase):
    def test_sums_observations_across_control_prefixes(self):
        def fake_get(url, params=None, headers=None, timeout=None,
                     attempts=None, rate_limiter=None):
            return _FakeResponse(
                json_data={"data": {"bgp_state": [{"path": [1]}, {"path": [2]}]}}
            )

        with mock.patch.object(ubd, "get_with_retries", side_effect=fake_get):
            total = probe_bgp_state_health()
        # 2 observations per prefix across all control prefixes.
        self.assertEqual(total, 2 * len(ubd.CONTROL_PREFIXES))

    def test_returns_zero_when_upstream_fails(self):
        import requests

        with mock.patch.object(ubd, "get_with_retries",
                               side_effect=requests.ConnectionError("down")):
            total = probe_bgp_state_health()
        self.assertEqual(total, 0)
        self.assertLess(total, ubd.CONTROL_MIN_OBSERVATIONS)


class TestDiscoverLatestRibDumps(unittest.TestCase):
    FIXTURE = {
        "data": [
            {"collector_id": "rrc00", "data_type": "rib",
             "url": "https://data.ris.ripe.net/rrc00/x.gz", "rough_size": 400, "delay": 5000},
            {"collector_id": "rrc02", "data_type": "rib",  # stale (years old)
             "url": "https://data.ris.ripe.net/rrc02/x.gz", "rough_size": 9, "delay": 999999999},
            {"collector_id": "rrc00", "data_type": "updates",  # not a rib
             "url": "https://data.ris.ripe.net/rrc00/u.gz", "rough_size": 5, "delay": 600},
            {"collector_id": "route-views2", "data_type": "rib",
             "url": "http://archive.routeviews.org/x.bz2", "rough_size": 75, "delay": 5000},
            {"collector_id": "route-views.jinx", "data_type": "rib",  # stale routeviews
             "url": "http://archive.routeviews.org/jinx.bz2", "rough_size": 11, "delay": 999999999},
        ]
    }

    def _patched(self, *args, **kwargs):
        return _FakeResponse(json_data=self.FIXTURE)

    def test_riperis_filters_stale_and_non_rib(self):
        with mock.patch.object(ubd, "get_with_retries", side_effect=self._patched):
            dumps = discover_latest_rib_dumps("riperis")
        cols = [d["collector"] for d in dumps]
        self.assertEqual(cols, ["rrc00"])  # rrc02 stale, updates dropped

    def test_routeviews_split_and_sorted(self):
        with mock.patch.object(ubd, "get_with_retries", side_effect=self._patched):
            dumps = discover_latest_rib_dumps("routeviews")
        cols = [d["collector"] for d in dumps]
        self.assertEqual(cols, ["route-views2"])  # jinx stale, rrc* excluded


class TestMrtElemToRoute(unittest.TestCase):
    def test_from_dict(self):
        elem = {"prefix": "103.11.136.0/24", "peer_ip": "10.0.0.1",
                "as_path": "174 45273 65001"}
        rec = mrt_elem_to_route(elem, "rrc00")
        self.assertEqual(rec, {
            "target_prefix": "103.11.136.0/24",
            "source_id": "rrc00:10.0.0.1",
            "path": ["174", "45273", "65001"],
        })

    def test_from_object_with_list_path(self):
        elem = types.SimpleNamespace(prefix="1.2.3.0/24", peer_ip="2.2.2.2",
                                     as_path=[174, 45273])
        rec = mrt_elem_to_route(elem, "route-views2")
        self.assertEqual(rec["source_id"], "route-views2:2.2.2.2")
        self.assertEqual(rec["path"], ["174", "45273"])


class TestMrtBgpStateParity(unittest.TestCase):
    """The 1-to-1 guarantee: MRT-derived records must analyze identically to
    bgp-state-derived records for equivalent observations."""

    def test_analyze_routes_identical(self):
        country_asns = {"45273", "65001"}

        # bgp-state shape: path as ints, RIPEstat-style source_id.
        bgp_state_routes = [
            {"target_prefix": "1.1.1.0/24", "source_id": "S-A",
             "path": [174, 45273, 65001]},
            {"target_prefix": "1.1.1.0/24", "source_id": "S-B",
             "path": [174, 45273, 65001]},
            {"target_prefix": "2.2.0.0/16", "source_id": "S-A",
             "path": [3356, 45273]},
        ]

        # MRT shape: built via the adapter from parser-style elems.
        elems = [
            {"prefix": "1.1.1.0/24", "peer_ip": "10.0.0.1", "as_path": "174 45273 65001"},
            {"prefix": "1.1.1.0/24", "peer_ip": "10.0.0.2", "as_path": "174 45273 65001"},
            {"prefix": "2.2.0.0/16", "peer_ip": "10.0.0.1", "as_path": "3356 45273"},
        ]
        mrt_routes = [mrt_elem_to_route(e, "rrc00") for e in elems]

        a = analyze_routes(bgp_state_routes, country_asns)
        b = analyze_routes(mrt_routes, country_asns)

        self.assertEqual(a["valid_obs"], b["valid_obs"])
        self.assertEqual(a["outside_counts"], b["outside_counts"])
        self.assertEqual(a["iig_counts"], b["iig_counts"])
        self.assertEqual(a["local_isp_counts"], b["local_isp_counts"])
        self.assertEqual(a["edge_intl"], b["edge_intl"])
        self.assertEqual(a["edge_domestic"], b["edge_domestic"])


class TestHistorySnapshots(unittest.TestCase):
    def test_snapshot_filename_is_colon_free(self):
        name = _snapshot_filename("2026-06-04T14:00:48Z")
        self.assertEqual(name, "20260604T140048Z.json")
        self.assertNotIn(":", name)

    def test_parse_snapshot_ts_roundtrip(self):
        name = _snapshot_filename("2026-06-04T14:00:48Z")
        dt = _parse_snapshot_ts(name)
        self.assertEqual(dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "2026-06-04T14:00:48Z")

    def test_parse_snapshot_ts_rejects_garbage(self):
        self.assertIsNone(_parse_snapshot_ts("index.json"))
        self.assertIsNone(_parse_snapshot_ts("not-a-snapshot.json"))

    def _iso(self, dt):
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    def test_prune_removes_only_old_snapshots(self):
        import datetime as _dt
        import tempfile

        now = _dt.datetime.now(_dt.timezone.utc)
        fresh = self._iso(now - _dt.timedelta(days=1))
        stale = self._iso(now - _dt.timedelta(days=10))

        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(ubd, "_history_dir", return_value=tmp):
                archive_snapshot("BD", {"stats": {}}, {"last_updated": fresh})
                archive_snapshot("BD", {"stats": {}}, {"last_updated": stale})
                self.assertEqual(len(os.listdir(tmp)), 2)
                prune_history("BD", retention_days=7)
                remaining = sorted(os.listdir(tmp))
            self.assertEqual(remaining, [_snapshot_filename(fresh)])

    def test_write_index_sorted_with_stats(self):
        import tempfile

        older = "2026-06-01T06:00:00Z"
        newer = "2026-06-03T06:00:00Z"
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(ubd, "_history_dir", return_value=tmp):
                # Archive out of order to confirm the manifest sorts ascending.
                archive_snapshot("BD", {"stats": {"valid_observations": 222, "total_edges": 22}},
                                 {"last_updated": newer})
                archive_snapshot("BD", {"stats": {"valid_observations": 111, "total_edges": 11}},
                                 {"last_updated": older})
                write_history_index("BD", retention_days=7)
                with open(os.path.join(tmp, "index.json")) as f:
                    index = json.load(f)

        self.assertEqual(index["country"], "BD")
        self.assertEqual(index["retention_days"], 7)
        ts_list = [s["ts"] for s in index["snapshots"]]
        self.assertEqual(ts_list, [older, newer])
        self.assertEqual(index["snapshots"][0]["stats"]["valid_observations"], 111)
        self.assertEqual(index["snapshots"][1]["file"], _snapshot_filename(newer))


@unittest.skipUnless(os.environ.get("RUN_NETWORK_TESTS") == "1",
                     "network test; set RUN_NETWORK_TESTS=1 to enable")
class TestLiveBrokerSmoke(unittest.TestCase):
    def test_broker_returns_fresh_ris_dumps(self):
        dumps = discover_latest_rib_dumps("riperis")
        self.assertTrue(dumps)
        self.assertTrue(all(d["collector"].startswith("rrc") for d in dumps))
        self.assertTrue(all(d["url"].endswith(".gz") for d in dumps))


if __name__ == "__main__":
    unittest.main()
