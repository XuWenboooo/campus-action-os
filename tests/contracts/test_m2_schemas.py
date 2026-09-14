import json
from pathlib import Path

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[2]


def load(name):
    return json.loads((ROOT / "schemas" / "interfaces" / "v1" / name).read_text(encoding="utf-8"))


def test_m2_schemas_are_valid_draft_2020_12_documents():
    request = load("text-parse-request.schema.json")
    assessment = load("document-assessment.schema.json")
    response = load("text-parse-response.schema.json")
    for schema in (request, assessment, response):
        Draft202012Validator.check_schema(schema)
        assert schema["$schema"].endswith("draft/2020-12/schema")
    assert response["properties"]["verified_actions"]["items"]["$ref"].endswith(
        "verified-action-object.schema.json"
    )
    assert response["properties"]["action_graph"]["anyOf"][0]["$ref"].endswith(
        "action-graph.schema.json"
    )


def test_m2_schemas_have_explicit_closed_privacy_boundaries():
    request = load("text-parse-request.schema.json")
    profile = request["$defs"]["userProfile"]
    assert profile["unevaluatedProperties"] is False
    assert "student_id" not in profile["properties"]
    assert request["$defs"]["document"]["properties"]["content_type"]["const"] == "text/plain"
