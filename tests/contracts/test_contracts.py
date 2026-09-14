import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker


ROOT = Path(__file__).resolve().parents[2]


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


VAO_SCHEMA = load(ROOT / 'schemas/v1/verified-action-object.schema.json')
GRAPH_SCHEMA = load(ROOT / 'schemas/v1/action-graph.schema.json')
VALID = load(ROOT / 'examples/verified-action-object/valid/examples.json')
BY_CASE = {item['case']: item for item in VALID}


def schema_errors(schema, instance):
    return list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(instance))


def evidence_rules(action):
    errors = []
    evidence = {item['evidence_id']: item for item in action['evidence']}
    evidence_fields = {item['field_name'] for item in action['evidence']}
    field_aliases = {'user_relevance': {'user_relevance', 'target_population'}}
    for field, status in action['field_status'].items():
        if status == 'explicit' and not evidence_fields.intersection(field_aliases.get(field, {field})):
            errors.append(f'explicit {field} has no matching evidence')

    def check_refs(ids, field):
        for evidence_id in ids:
            if evidence_id not in evidence:
                errors.append(f'dangling evidence reference: {evidence_id} ({field})')

    for step in action['steps']:
        check_refs(step['evidence_ids'], 'steps')
        for material in step.get('required_materials', []):
            check_refs(material['evidence_ids'], 'required_materials')
    for material in action['required_materials']:
        check_refs(material['evidence_ids'], 'required_materials')
    check_refs(action['deadline']['evidence_ids'], 'deadline')
    for claim_name in ('location', 'platform', 'entry_link', 'consequence'):
        claim = action[claim_name]
        if claim is not None:
            check_refs(claim['evidence_ids'], claim_name)
    for condition in action['conditions']:
        check_refs(condition['evidence_ids'], 'conditions')
    for exception in action['exceptions']:
        check_refs(exception['evidence_ids'], 'exceptions')
    if action['deadline']['value'] is None and action['deadline']['precision'] != 'unknown':
        errors.append('null deadline value requires unknown precision')
    if action['deadline']['precision'] == 'unknown' and action['deadline']['value'] is not None:
        errors.append('unknown deadline precision requires null value')
    if action['verification_status'] == 'conflict' and action['task_status'] in {'completed', 'in_progress'}:
        errors.append('conflicted object cannot be an active/completed task')
    if action['result_stage'] == 'model_output' and action['verification_status'] == 'passed':
        errors.append('model output cannot claim passed verification')
    for field in ('location', 'platform'):
        if action[field] is None and action['field_status'][field] == 'explicit':
            errors.append(f'null {field} cannot be explicit')
    return errors


def graph_rules(graph):
    errors = []
    nodes = {node['node_id'] for node in graph['nodes']}
    if len(nodes) != len(graph['nodes']):
        errors.append('duplicate node_id')
    edge_ids = [edge['edge_id'] for edge in graph['edges']]
    if len(set(edge_ids)) != len(edge_ids):
        errors.append('duplicate edge_id')
    action_ids = [node.get('action_id') for node in graph['nodes'] if node['node_type'] == 'action']
    if len(set(action_ids)) != len(action_ids):
        errors.append('duplicate action_id')
    decision_conditions = {condition for node in graph['nodes'] for condition in node.get('condition_ids', [])}
    adjacency = {node: [] for node in nodes}
    for edge in graph['edges']:
        if edge['from_node_id'] not in nodes or edge['to_node_id'] not in nodes:
            errors.append('dangling graph endpoint')
        if edge['edge_type'] == 'branches_to' and edge.get('condition_id') not in decision_conditions:
            errors.append('branch condition is not declared by a decision node')
        if edge['edge_type'] in {'blocks', 'requires', 'branches_to', 'postpones', 'replaces'} and edge['from_node_id'] in nodes and edge['to_node_id'] in nodes:
            adjacency[edge['from_node_id']].append(edge['to_node_id'])
    visiting, visited = set(), set()

    def visit(node):
        if node in visiting:
            return True
        if node in visited:
            return False
        visiting.add(node)
        if any(visit(child) for child in adjacency[node]):
            return True
        visiting.remove(node)
        visited.add(node)
        return False

    if any(visit(node) for node in nodes):
        errors.append('execution dependency cycle')
    return errors


@pytest.mark.parametrize('example', VALID, ids=lambda item: item['case'])
def test_migrated_examples_pass_schema_and_rules(example):
    artifact = copy.deepcopy(example)
    artifact.pop('case', None)
    assert not schema_errors(VAO_SCHEMA, artifact)
    assert not evidence_rules(artifact)


def test_schema_documents_are_valid_and_graph_example_is_valid():
    Draft202012Validator.check_schema(VAO_SCHEMA)
    Draft202012Validator.check_schema(GRAPH_SCHEMA)
    assert VAO_SCHEMA['$schema'].endswith('draft/2020-12/schema')
    graph = load(ROOT / 'examples/action-graphs/branch-and-revision.json')
    assert not schema_errors(GRAPH_SCHEMA, graph)
    assert not graph_rules(graph)


@pytest.mark.parametrize('field', VAO_SCHEMA['required'])
def test_each_freeze_required_field_is_required(field):
    item = copy.deepcopy(BY_CASE['single-action'])
    item.pop('case', None)
    item.pop(field, None)
    assert schema_errors(VAO_SCHEMA, item)


def test_old_names_and_enums_are_rejected():
    item = copy.deepcopy(BY_CASE['single-action'])
    item.pop('case', None)
    item['source_document_id'] = item.pop('document_id')
    assert schema_errors(VAO_SCHEMA, item)
    item = copy.deepcopy(BY_CASE['single-action'])
    item.pop('case', None)
    item['user_relevance'] = 'not_relevant'
    assert schema_errors(VAO_SCHEMA, item)


@pytest.mark.parametrize('mutation', ['string_null', 'wrong_precision', 'wrong_boundary', 'explicit_without_evidence', 'ai_estimated_as_explicit', 'passed_from_model_output'])
def test_runtime_semantics_reject_unsafe_legacy_or_inferred_values(mutation):
    item = copy.deepcopy(BY_CASE['single-action'])
    item.pop('case', None)
    if mutation == 'string_null':
        item['deadline']['value'] = 'null'
    elif mutation == 'wrong_precision':
        item['deadline']['precision'] = 'datetime'
    elif mutation == 'wrong_boundary':
        item['deadline']['boundary_semantics'] = 'inclusive'
    elif mutation == 'explicit_without_evidence':
        item['field_status']['deadline'] = 'explicit'
        item['evidence'] = [entry for entry in item['evidence'] if entry['field_name'] != 'deadline']
    elif mutation == 'ai_estimated_as_explicit':
        item['field_status']['steps'] = 'explicit'
        item['evidence'] = [entry for entry in item['evidence'] if entry['field_name'] != 'steps']
    elif mutation == 'passed_from_model_output':
        item['result_stage'] = 'model_output'
    assert schema_errors(VAO_SCHEMA, item) or evidence_rules(item)


def test_unknown_deadline_uses_real_null_and_zero_confidence_is_allowed():
    item = copy.deepcopy(BY_CASE['single-action'])
    item.pop('case', None)
    item['deadline'] = {'value': None, 'precision': 'unknown', 'boundary_semantics': 'unknown', 'epistemic_status': 'unknown', 'evidence_ids': []}
    item['confidence']['score'] = 0
    item['field_status']['deadline'] = 'unknown'
    assert not schema_errors(VAO_SCHEMA, item)
    assert not evidence_rules(item)


@pytest.mark.parametrize('status', ['conflict', 'user_confirmation_required'])
def test_conflict_and_confirmation_are_explicit_verification_states(status):
    item = copy.deepcopy(BY_CASE['single-action'])
    item.pop('case', None)
    item['verification_status'] = status
    item['result_stage'] = 'rule_reviewed'
    assert not schema_errors(VAO_SCHEMA, item)


@pytest.mark.parametrize('case', load(ROOT / 'examples/action-graphs/invalid.json'), ids=lambda item: item['name'])
def test_invalid_graph_examples_are_rejected(case):
    graph = case['graph']
    assert schema_errors(GRAPH_SCHEMA, graph) or graph_rules(graph)
