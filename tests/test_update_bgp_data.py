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
    apply_geo_results,
    build_viz_data,
    classify_tentative_iig_type,
    discover_latest_rib_dumps,
    get_country_resources_from_rir_stats,
    fetch_geo_country,
    fetch_registered_country,
    is_reserved_asn,
    load_licensed_asns,
    needs_name_lookup,
    parse_rir_country,
    refresh_registered_countries,
    get_with_retries,
    ipv4_range_to_prefixes,
    mrt_elem_to_route,
    probe_bgp_state_health,
    _snapshot_filename,
    _parse_snapshot_ts,
    archive_snapshot,
    prune_history,
    tentative_gateway_asns,
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
        )
        self.assertEqual(result, "iig")

    def test_offshore_without_domestic_is_enterprise(self):
        result = classify_tentative_iig_type(
            asn="200",
            is_bd_registered=True,
            geo_country="SG",
            btrc_licensed_asns=set(),
            iigs_with_domestic=set(),
        )
        self.assertEqual(result, "offshore-enterprise")

    def test_offshore_with_domestic_is_gateway(self):
        result = classify_tentative_iig_type(
            asn="201",
            is_bd_registered=True,
            geo_country="SG",
            btrc_licensed_asns=set(),
            iigs_with_domestic={"201"},
        )
        self.assertEqual(result, "offshore-gateway")

    def test_domestic_customer_evidence_is_detected_iig(self):
        result = classify_tentative_iig_type(
            asn="300",
            is_bd_registered=True,
            geo_country="BD",
            btrc_licensed_asns=set(),
            iigs_with_domestic={"300"},
        )
        self.assertEqual(result, "detected-iig")

    def test_direct_international_peer_without_customers_is_local_company(self):
        # Connecting abroad directly (e.g. through a DDoS-protection service)
        # doesn't make a network a gateway: no other BD network goes through it.
        result = classify_tentative_iig_type(
            asn="45273",
            is_bd_registered=True,
            geo_country="BD",
            btrc_licensed_asns=set(),
            iigs_with_domestic=set(),
        )
        self.assertEqual(result, "local-company")

    def test_non_gateway_becomes_local_company(self):
        result = classify_tentative_iig_type(
            asn="999",
            is_bd_registered=True,
            geo_country="BD",
            btrc_licensed_asns=set(),
            iigs_with_domestic=set(),
        )
        self.assertEqual(result, "local-company")


class TestBuildVizDataClassification(unittest.TestCase):
    def test_build_viz_data_flags_direct_peers_without_customers(self):
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
        self.assertEqual(nodes["45273"]["type"], "local-company")
        self.assertEqual(nodes["45273"]["abroad_link"], "only-abroad")
        self.assertEqual(nodes["200"]["type"], "offshore-gateway")
        self.assertEqual(nodes["65001"]["type"], "local-company")
        self.assertEqual(nodes["65001"]["abroad_link"], "")
        self.assertEqual(nodes["174"]["type"], "outside")

        self.assertEqual(data["stats"]["total_detected_iig"], 0)
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


class TestRegisteredCountry(unittest.TestCase):
    """The registered country comes from the RIRs, never the holder handle."""

    @staticmethod
    def _payload(*locations, status="ok"):
        return {"status": status, "data": {"located_resources": [
            {"resource": "1", "location": loc} for loc in locations]}}

    def test_parse_takes_registry_location(self):
        self.assertEqual(parse_rir_country(self._payload("AE")), "AE")
        self.assertEqual(parse_rir_country(self._payload("sg")), "SG")

    def test_parse_keeps_regions_and_drops_unknown(self):
        self.assertEqual(parse_rir_country(self._payload("EU")), "EU")
        self.assertEqual(parse_rir_country(self._payload("ZZ")), "")
        self.assertEqual(parse_rir_country(self._payload()), "")
        self.assertEqual(parse_rir_country({}), "")

    def test_fetch_returns_none_when_lookup_fails(self):
        import requests

        with mock.patch.object(ubd, "get_with_retries", side_effect=requests.ConnectionError("down")):
            self.assertIsNone(fetch_registered_country("8529"))
        with mock.patch.object(ubd, "get_with_retries",
                               return_value=_FakeResponse(json_data=self._payload(status="error"))):
            self.assertIsNone(fetch_registered_country("8529"))
        with mock.patch.object(ubd, "get_with_retries",
                               return_value=_FakeResponse(json_data=self._payload("AE"))):
            self.assertEqual(fetch_registered_country("8529"), "AE")

    def test_refresh_replaces_handle_guesses(self):
        results = {
            # Guessed from "OMANTEL-AS" by older versions and cached.
            "8529": {"asn": "8529", "name": "OMANTEL-AS - Zain Omantel", "country": "AS"},
            "7473": {"asn": "7473", "name": "SINGTEL-AS-AP Singtel", "country": "AP"},
            # Already from the registry: not looked up again.
            "1299": {"asn": "1299", "country": "SE", "country_source": "rir"},
            # BD ASNs come from the country resource list.
            "58717": {"asn": "58717", "country": "BD"},
            # Lookup fails: the guess is dropped, the well-known fallback used.
            "174": {"asn": "174", "country": "AS"},
            "999": {"asn": "999", "country": "AS"},
        }
        registry = {"8529": "AE", "7473": "SG", "174": None, "999": None}
        looked_up = []

        def fake_fetch(asn, rate_limiter):
            looked_up.append(asn)
            return registry[asn]

        refresh_registered_countries(results, {"58717"}, rate_limiter=None, fetch=fake_fetch)

        self.assertEqual(sorted(looked_up), ["174", "7473", "8529", "999"])
        self.assertEqual(results["8529"]["country"], "AE")
        self.assertEqual(results["8529"]["country_source"], "rir")
        self.assertEqual(results["7473"]["country"], "SG")
        self.assertEqual(results["1299"]["country"], "SE")
        self.assertEqual(results["58717"]["country"], "BD")
        self.assertEqual(results["174"]["country"], "US")
        self.assertNotIn("country_source", results["174"])   # retried next run
        self.assertEqual(results["999"]["country"], "")


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


def _prefixes(n):
    return [f"10.{i // 256}.{i % 256}.0/24" for i in range(n)]


class TestFetchBgpRoutes(unittest.TestCase):
    """bgp-state batches: final retry pass and the completeness report."""

    def _run(self, prefixes, fetch_batch):
        with mock.patch.object(ubd.time, "sleep"):
            return ubd.fetch_bgp_routes(prefixes, ubd.RateLimiter(1000),
                                        fetch_batch=fetch_batch, retry_pause=0)

    def test_all_batches_ok(self):
        prefixes = _prefixes(400)

        def fetch(batch):
            return [{"target_prefix": p, "path": [1, 2]} for p in batch]

        routes, report = self._run(prefixes, fetch)
        self.assertEqual(len(routes), 400)
        self.assertGreater(report["batches"], 1)
        self.assertEqual(report["batches_failed_first_try"], 0)
        self.assertEqual(report["prefixes"], 400)
        self.assertEqual(report["prefixes_missing"], 0)

    def test_failed_batch_is_retried_at_the_end(self):
        import threading

        prefixes = _prefixes(400)
        first_pass = len(ubd.chunk_prefixes(prefixes))
        calls = []
        lock = threading.Lock()

        def fetch(batch):
            # Every request of the first pass fails: a transient run of 500s.
            with lock:
                calls.append(batch)
                n = len(calls)
            if n <= first_pass:
                return None
            return [{"target_prefix": p, "path": [1, 2]} for p in batch]

        routes, report = self._run(prefixes, fetch)
        self.assertEqual(len(routes), 400)
        self.assertEqual(report["batches_failed_first_try"], report["batches"])
        self.assertEqual(report["prefixes_missing"], 0)

    def test_persistent_failure_only_loses_the_split_containing_it(self):
        prefixes = _prefixes(400)
        bad = prefixes[5]

        def fetch(batch):
            if bad in batch:
                return None
            return [{"target_prefix": p, "path": [1, 2]} for p in batch]

        routes, report = self._run(prefixes, fetch)
        first_batch = ubd.chunk_prefixes(prefixes)[0]
        self.assertEqual(report["batches_failed_first_try"], 1)
        self.assertGreater(report["prefixes_missing"], 0)
        # The retry splits the failed batch, so most of it is recovered.
        self.assertLess(report["prefixes_missing"], len(first_batch) // 2)
        self.assertNotIn(bad, {r["target_prefix"] for r in routes})
        self.assertEqual(len(routes), 400 - report["prefixes_missing"])


class TestEnforceRouteCompleteness(unittest.TestCase):
    def test_complete_run_passes(self):
        ubd.enforce_route_completeness({"prefixes": 1000, "prefixes_missing": 0})

    def test_small_loss_below_threshold_passes(self):
        limit = int(1000 * ubd.MAX_MISSING_PREFIX_SHARE)
        ubd.enforce_route_completeness({"prefixes": 1000, "prefixes_missing": limit})

    def test_loss_above_threshold_fails_the_run(self):
        limit = int(1000 * ubd.MAX_MISSING_PREFIX_SHARE)
        with self.assertRaises(RuntimeError):
            ubd.enforce_route_completeness({"prefixes": 1000, "prefixes_missing": limit + 1})

    def test_threshold_is_below_run_to_run_noise(self):
        # Normal runs move valid observations by about +/-1%; a guard looser
        # than that would let a partial fetch pass as a real change.
        self.assertLessEqual(ubd.MAX_MISSING_PREFIX_SHARE, 0.005)


class TestFetchAnnouncedPrefixes(unittest.TestCase):
    def test_collects_successes_and_failures(self):
        def fetch_one(asn, stop):
            if asn == "2":
                return None
            return [f"{asn}.0.0.0/8"]

        result = ubd.fetch_announced_prefixes(["1", "2", "3"], ubd.RateLimiter(1000),
                                              fetch_one=fetch_one)
        self.assertEqual(result["prefixes_by_asn"], {"1": ["1.0.0.0/8"], "3": ["3.0.0.0/8"]})
        self.assertEqual(result["failed"], ["2"])
        self.assertEqual(result["not_fetched"], [])
        self.assertFalse(result["timed_out"])

    def test_stops_at_the_time_budget(self):
        import time as _time

        def slow(asn, stop):
            _time.sleep(0.05)
            return []

        asns = [str(i) for i in range(400)]
        start = _time.time()
        result = ubd.fetch_announced_prefixes(asns, ubd.RateLimiter(1000),
                                              budget_seconds=0.2, fetch_one=slow)
        self.assertTrue(result["timed_out"])
        self.assertLess(_time.time() - start, 1.5)
        self.assertGreater(len(result["not_fetched"]), 0)
        self.assertEqual(len(result["prefixes_by_asn"]) + len(result["failed"])
                         + len(result["not_fetched"]), 400)


class TestGetAnnouncedPrefixes(unittest.TestCase):
    def _cache(self, tmp, by_asn):
        path = os.path.join(tmp, "announced_prefixes.json")
        with open(path, "w") as f:
            json.dump({"country": "BD", "updated_at": "2026-10-31T00:00:00Z",
                       "asns": by_asn}, f)
        return path

    def test_falls_back_to_cache_for_failed_asns(self):
        import tempfile

        def fake_fetch(asns, rate_limiter, budget_seconds=None):
            return {"prefixes_by_asn": {"1": ["1.0.0.0/24"], "3": ["3.0.0.0/24"]},
                    "failed": ["2"], "not_fetched": [], "timed_out": False,
                    "elapsed_seconds": 1.0}

        with tempfile.TemporaryDirectory() as tmp:
            path = self._cache(tmp, {"1": ["1.0.0.0/23"], "2": ["2.0.0.0/24"]})
            prefixes, report = ubd.get_announced_prefixes(
                {"1", "2", "3"}, ubd.RateLimiter(1000), path, fetch=fake_fetch)
            with open(path) as f:
                saved = json.load(f)

        self.assertEqual(prefixes, {"1.0.0.0/24", "2.0.0.0/24", "3.0.0.0/24"})
        self.assertEqual(report["asns"], 3)
        self.assertEqual(report["fetched"], 2)
        self.assertEqual(report["failed"], 1)
        self.assertEqual(report["from_cache"], 1)
        self.assertEqual(report["missing"], 0)
        self.assertTrue(report["used_cache"])
        # The cache keeps the last good answer per ASN.
        self.assertEqual(saved["asns"], {"1": ["1.0.0.0/24"], "2": ["2.0.0.0/24"],
                                         "3": ["3.0.0.0/24"]})

    def test_budget_applies_only_when_a_cache_exists(self):
        import tempfile

        seen = {}

        def fake_fetch(asns, rate_limiter, budget_seconds=None):
            seen["budget"] = budget_seconds
            seen["order"] = list(asns)
            return {"prefixes_by_asn": {a: [] for a in asns}, "failed": [],
                    "not_fetched": [], "timed_out": False, "elapsed_seconds": 0.0}

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "announced_prefixes.json")
            ubd.get_announced_prefixes({"1"}, ubd.RateLimiter(1000), path,
                                       budget_seconds=60, fetch=fake_fetch)
            self.assertIsNone(seen["budget"])

            self._cache(tmp, {"1": [], "2": []})
            ubd.get_announced_prefixes({"1", "2", "9"}, ubd.RateLimiter(1000), path,
                                       budget_seconds=60, fetch=fake_fetch)
            self.assertEqual(seen["budget"], 60)
            # ASNs the cache doesn't know yet go first, so a timeout skips
            # only ASNs that have a fallback.
            self.assertEqual(seen["order"][0], "9")

    def test_timeout_without_cache_entry_counts_as_missing(self):
        import tempfile

        def fake_fetch(asns, rate_limiter, budget_seconds=None):
            return {"prefixes_by_asn": {"1": ["1.0.0.0/24"]}, "failed": [],
                    "not_fetched": ["2", "3"], "timed_out": True,
                    "elapsed_seconds": 60.0}

        with tempfile.TemporaryDirectory() as tmp:
            path = self._cache(tmp, {"2": ["2.0.0.0/24"]})
            prefixes, report = ubd.get_announced_prefixes(
                {"1", "2", "3"}, ubd.RateLimiter(1000), path, fetch=fake_fetch)

        self.assertEqual(prefixes, {"1.0.0.0/24", "2.0.0.0/24"})
        self.assertTrue(report["timed_out"])
        self.assertEqual(report["from_cache"], 1)
        self.assertEqual(report["missing"], 1)


class TestRunCompleteness(unittest.TestCase):
    ROUTES_OK = {"batches": 145, "batches_failed_first_try": 2, "prefixes": 15000,
                 "prefixes_missing": 0}
    ANNOUNCED_OK = {"asns": 2023, "fetched": 2023, "failed": 0, "from_cache": 0,
                    "missing": 0, "used_cache": False, "timed_out": False}

    def test_complete_when_nothing_missing_or_cached(self):
        c = ubd.build_completeness(self.ROUTES_OK, self.ANNOUNCED_OK)
        self.assertTrue(c["complete"])
        self.assertEqual(c["routes"], self.ROUTES_OK)
        self.assertEqual(c["announced_prefixes"], self.ANNOUNCED_OK)

    def test_missing_prefixes_make_it_incomplete(self):
        routes = dict(self.ROUTES_OK, prefixes_missing=30)
        self.assertFalse(ubd.build_completeness(routes, self.ANNOUNCED_OK)["complete"])

    def test_cached_announced_prefixes_make_it_incomplete(self):
        announced = dict(self.ANNOUNCED_OK, fetched=1500, from_cache=523,
                         used_cache=True, timed_out=True)
        self.assertFalse(ubd.build_completeness(self.ROUTES_OK, announced)["complete"])

    def test_unknown_without_route_report(self):
        # MRT fallback runs don't fetch bgp-state batches.
        self.assertIsNone(ubd.build_completeness(None, self.ANNOUNCED_OK)["complete"])


def _analysis(edge_intl, edge_domestic, direct_peers_map=None, valid_obs=0):
    """A minimal analysis dict, with the counters derived from the edges."""
    outside, iig, local = collections.Counter(), collections.Counter(), collections.Counter()
    for (src, dst), c in edge_intl.items():
        outside[src] += c
        iig[dst] += c
    for (src, _), c in edge_domestic.items():
        local[src] += c
    return {
        "outside_counts": outside, "iig_counts": iig, "local_isp_counts": local,
        "edge_intl": collections.Counter(edge_intl),
        "edge_domestic": collections.Counter(edge_domestic),
        "direct_peers_map": direct_peers_map or {},
        "valid_obs": valid_obs,
    }


class TestLicensedGatewaysStayLicensed(unittest.TestCase):
    def test_licensed_asn_seen_only_behind_another_gateway_is_iig(self):
        # BTCL's AS45588 reaches the world through BTCL's AS17494, so it only
        # ever appears as the source of a domestic connection.
        analysis = _analysis(
            edge_intl={("6939", "17494"): 50},
            edge_domestic={("45588", "17494"): 30},
        )
        data = build_viz_data(analysis, {}, {"17494", "45588"},
                              btrc_licensed_asns={"17494", "45588"})
        nodes = {n["asn"]: n for n in data["nodes"]}
        self.assertEqual(nodes["45588"]["type"], "iig")
        self.assertTrue(nodes["45588"]["licensed"])
        self.assertEqual(data["stats"]["total_iig"], 2)
        self.assertEqual(data["stats"]["total_local_company"], 0)


class TestShare(unittest.TestCase):
    def test_gateway_share_counts_only_routes_crossing_the_border(self):
        analysis = _analysis(
            edge_intl={("174", "100"): 60, ("6939", "200"): 40},
            edge_domestic={("300", "100"): 50, ("400", "200"): 10},
        )
        data = build_viz_data(analysis, {}, {"100", "200", "300", "400"},
                              btrc_licensed_asns={"100", "200"})
        nodes = {n["asn"]: n for n in data["nodes"]}
        self.assertAlmostEqual(nodes["100"]["percentage"], 60.0)
        self.assertAlmostEqual(nodes["200"]["percentage"], 40.0)
        self.assertAlmostEqual(nodes["174"]["percentage"], 60.0)
        self.assertAlmostEqual(nodes["300"]["percentage"], 50.0)
        # Size and ranking still use every route the network carries.
        self.assertEqual(nodes["100"]["traffic"], 110)
        gateway_total = sum(n["percentage"] for n in data["nodes"] if n["type"] == "iig")
        self.assertAlmostEqual(gateway_total, 100.0)


class TestCustomersBeyondDrawnConnections(unittest.TestCase):
    def test_customer_evidence_uses_every_domestic_connection(self):
        # Only the busiest domestic connection is drawn, but AS200 still has
        # a BD network behind it and stays a detected gateway.
        analysis = _analysis(
            edge_intl={("174", "100"): 90, ("174", "200"): 10},
            edge_domestic={("300", "100"): 80, ("400", "200"): 5},
            direct_peers_map={"100": ["174"], "200": ["174"]},
        )
        data = build_viz_data(analysis, {}, {"100", "200", "300", "400"},
                              btrc_licensed_asns={"100"}, top_domestic=1)
        nodes = {n["asn"]: n for n in data["nodes"]}
        self.assertEqual(nodes["200"]["type"], "detected-iig")
        self.assertEqual(nodes["200"]["abroad_link"], "")
        self.assertEqual(data["stats"]["total_domestic_edges"], 1)


class TestGeolocation(unittest.TestCase):
    def test_tentative_gateways_cover_every_drawn_connection(self):
        edge_intl = collections.Counter({("174", str(1000 + i)): 2000 - i for i in range(1200)})
        country_asns = {str(1000 + i) for i in range(1200)}
        asns = tentative_gateway_asns(edge_intl, country_asns, {"1000"})
        self.assertIn("2199", asns)          # 1,200th busiest, still drawn
        self.assertNotIn("1000", asns)       # licensed: no lookup needed
        self.assertEqual(len(asns), 1199)

    def test_failed_lookup_returns_none(self):
        import requests
        with mock.patch.object(ubd.requests, "get", side_effect=requests.Timeout("slow")):
            self.assertIsNone(fetch_geo_country("100", ubd.RateLimiter(requests_per_second=1000)))

    def test_lookup_without_located_space_is_an_answer(self):
        payload = {"status": "ok", "data": {"located_resources": []}}
        with mock.patch.object(ubd.requests, "get", return_value=_FakeResponse(json_data=payload)):
            geo = fetch_geo_country("100", ubd.RateLimiter(requests_per_second=1000))
        self.assertEqual(geo["dominant_country"], "BD")

    def test_failed_lookup_keeps_previous_answer(self):
        asn_info = {"100": {"name": "X", "geo_country": "SG",
                            "geo_country_data": {"dominant_country": "SG", "breakdown": []}}}
        offshore = apply_geo_results(asn_info, {"100": None, "200": {
            "dominant_country": "US", "breakdown": [], "bd_percentage": 0}})
        self.assertEqual(asn_info["100"]["geo_country"], "SG")
        self.assertEqual(offshore, {"100": "SG", "200": "US"})
        self.assertEqual(asn_info["200"]["geo_country"], "US")


class TestNameLookups(unittest.TestCase):
    def test_reserved_ranges(self):
        for asn in ["0", "23456", "64512", "65000", "65534", "65535", "64496",
                    "65551", "100000", "4200000000", "4294967295"]:
            self.assertTrue(is_reserved_asn(asn), asn)
        for asn in ["174", "58717", "131072", "154725", "399999"]:
            self.assertFalse(is_reserved_asn(asn), asn)

    def test_placeholder_names_are_looked_up_again(self):
        self.assertTrue(needs_name_lookup("154725", None))
        self.assertTrue(needs_name_lookup("154725", {"name": "AS154725", "holder": ""}))
        self.assertFalse(needs_name_lookup("58717", {"name": "SUMMIT", "holder": "SUMMIT"}))
        # Private-use numbers have no registry record; don't keep asking.
        self.assertFalse(needs_name_lookup("65000", {"name": "AS65000", "holder": ""}))

    def test_relookup_replaces_placeholder_and_keeps_cached_facts(self):
        cache = {"154725": {"asn": "154725", "name": "AS154725", "holder": "", "announced": False,
                            "country": "BD", "geo_country": "SG",
                            "geo_country_data": {"dominant_country": "SG", "breakdown": []}}}
        payload = {"status": "ok", "data": {"holder": "KINLL-AS - Kinll Technology", "announced": True}}
        with mock.patch.object(ubd.requests, "get", return_value=_FakeResponse(json_data=payload)), \
                mock.patch.object(ubd, "refresh_registered_countries"):
            info = ubd.fetch_asn_info(["154725"], {"154725"}, ubd.RateLimiter(requests_per_second=1000), cache)
        self.assertEqual(info["154725"]["name"], "KINLL-AS - Kinll Technology")
        self.assertEqual(info["154725"]["geo_country"], "SG")
        self.assertEqual(info["154725"]["country"], "BD")


class TestOwnLinkAbroad(unittest.TestCase):
    def _nodes(self, edge_intl, edge_domestic, igw=frozenset()):
        analysis = _analysis(edge_intl=edge_intl, edge_domestic=edge_domestic)
        data = build_viz_data(analysis, {}, {"100", "300", "400", "500"},
                              btrc_licensed_asns={"100"}, igw_licensed_asns=set(igw))
        return {n["asn"]: n for n in data["nodes"]}

    def test_seen_both_abroad_and_through_a_gateway(self):
        nodes = self._nodes({("174", "100"): 50, ("13335", "300"): 5}, {("300", "100"): 20})
        self.assertEqual(nodes["300"]["type"], "local-company")
        self.assertEqual(nodes["300"]["abroad_link"], "also-abroad")

    def test_seen_only_through_networks_abroad(self):
        nodes = self._nodes({("174", "100"): 50, ("6939", "400"): 5}, {})
        self.assertEqual(nodes["400"]["abroad_link"], "only-abroad")

    def test_ordinary_local_company_has_no_link_abroad(self):
        nodes = self._nodes({("174", "100"): 50}, {("300", "100"): 20})
        self.assertEqual(nodes["300"]["abroad_link"], "")

    def test_voice_gateway_licence_is_marked(self):
        nodes = self._nodes({("174", "100"): 50, ("6453", "500"): 5}, {("300", "100"): 20}, igw={"500"})
        self.assertTrue(nodes["500"]["igw"])
        self.assertEqual(nodes["500"]["abroad_link"], "only-abroad")
        self.assertFalse(nodes["300"]["igw"])
        self.assertFalse(nodes["100"]["igw"])


class TestReservedAsnsInPaths(unittest.TestCase):
    def test_private_asn_between_bd_networks_is_skipped(self):
        # A private number leaked between a gateway and its customer must not
        # turn into an "international network" with the customer as gateway.
        counters = [set()] + [collections.Counter() for _ in range(6)]
        seen, outside, iig, local, e_intl, e_dom, peers = counters
        ok = _process_single_route(
            {"target_prefix": "1.0.0.0/24", "source_id": "rrc00",
             "path": [9498, 139009, 65260, 134732]},
            {"139009", "134732"}, seen, outside, iig, local, e_intl, e_dom, peers)
        self.assertTrue(ok)
        self.assertEqual(dict(e_intl), {("9498", "139009"): 1})
        self.assertEqual(dict(e_dom), {("134732", "139009"): 1})
        self.assertNotIn("65260", outside)


class TestLicenceFiles(unittest.TestCase):
    def test_loads_asn_keys_and_skips_metadata(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"_description": "x", "45273": {"name": "A"}, "58665": {"name": "B"}}, f)
        try:
            self.assertEqual(load_licensed_asns(f.name), {"45273", "58665"})
        finally:
            os.unlink(f.name)
        self.assertEqual(load_licensed_asns("/no/such/file.json"), set())


class TestReclassifyStored(unittest.TestCase):
    def test_applies_current_rules_to_a_stored_snapshot(self):
        from scripts.reclassify_stored import reclassify_viz
        node = lambda asn, t, country="BD": {"asn": asn, "type": t, "licensed": False, "country": country,
                                              "geo_country": "", "announced": True, "traffic": 0,
                                              "rank": 1, "percentage": 0}
        viz = {
            "nodes": [node("174", "outside", "US"), node("100", "iig"), node("45588", "local-company"),
                      node("300", "detected-iig"), node("400", "detected-iig"), node("500", "local-company")],
            "edges": [
                {"source": "174", "target": "100", "count": 60, "type": "international"},
                {"source": "174", "target": "300", "count": 30, "type": "international"},
                {"source": "174", "target": "400", "count": 10, "type": "international"},
                {"source": "45588", "target": "100", "count": 40, "type": "domestic"},
                {"source": "500", "target": "400", "count": 5, "type": "domestic"},
                {"source": "300", "target": "100", "count": 8, "type": "domestic"},
            ],
            "stats": {"total_iig": 1, "total_detected_iig": 2, "total_local_company": 2},
            "layout": {"positions": {}},
        }
        moved = reclassify_viz(viz, iig_asns={"100", "45588"}, igw_asns={"300"})
        nodes = {n["asn"]: n for n in viz["nodes"]}
        self.assertEqual(moved, {"45588": ("local-company", "iig"), "300": ("detected-iig", "local-company")})
        self.assertEqual(nodes["400"]["type"], "detected-iig")      # a BD network goes through it
        self.assertEqual(nodes["300"]["abroad_link"], "also-abroad")
        self.assertTrue(nodes["300"]["igw"])
        self.assertEqual(nodes["500"]["abroad_link"], "")
        self.assertEqual(viz["stats"]["total_iig"], 2)
        self.assertEqual(viz["stats"]["total_detected_iig"], 1)
        self.assertAlmostEqual(nodes["100"]["percentage"], 60.0)
        self.assertNotIn("layout", viz)
        self.assertEqual(list(nodes["300"])[-3:], ["traffic", "rank", "percentage"])


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
