import collections
import os
import sys
import unittest
from unittest import mock

import requests


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from scripts.update_bgp_data import (  # noqa: E402
    _process_single_route,
    build_viz_data,
    classify_tentative_iig_type,
    get_country_resources,
)


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


class TestGetCountryResources(unittest.TestCase):
    @mock.patch("scripts.update_bgp_data.time.sleep")
    @mock.patch("scripts.update_bgp_data.requests.get")
    def test_retries_server_error_then_succeeds(self, mock_get, mock_sleep):
        first_response = mock.Mock()
        first_response.status_code = 500
        first_response.headers = {}
        first_response.raise_for_status.side_effect = requests.HTTPError("500 Server Error")

        second_response = mock.Mock()
        second_response.status_code = 200
        second_response.raise_for_status.return_value = None
        second_response.json.return_value = {
            "data": {
                "resources": {
                    "asn": [64500],
                    "ipv4": ["1.1.1.0/24"],
                    "ipv6": [],
                }
            }
        }

        mock_get.side_effect = [first_response, second_response]

        asns, alloc_prefixes = get_country_resources("BD", max_retries=2)

        self.assertEqual(asns, {"64500"})
        self.assertEqual(alloc_prefixes, ["1.1.1.0/24"])
        self.assertEqual(mock_get.call_count, 2)
        mock_sleep.assert_called_once_with(1)


if __name__ == "__main__":
    unittest.main()
