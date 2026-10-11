import pytest
from app.mcp.policy import PolicyEngine, PolicyResult

def test_repository_tools_allowed_in_all_phases():
    """Verify that repository tools are allowed in every phase."""
    engine = PolicyEngine()
    tools = ["get_repository_context", "list_files", "read_file", "search_code"]
    phases = ["req", "g1", "design", "g2", "code", "out"]
    
    for tool in tools:
        for phase in phases:
            result = engine.check_tool(phase, tool)
            assert result.allowed is True
            assert result.reason == "OK"

def test_requirements_tools_only_in_req_phase():
    """Verify submit_requirements is allowed in req but denied in design, code, g1."""
    engine = PolicyEngine()
    tool = "submit_requirements"
    
    assert engine.check_tool("req", tool).allowed is True
    
    for phase in ["design", "code", "g1"]:
        assert engine.check_tool(phase, tool).allowed is False

def test_design_tools_only_in_design_phase():
    """Verify submit_design is allowed in design but denied in req, code."""
    engine = PolicyEngine()
    tool = "submit_design"
    
    assert engine.check_tool("design", tool).allowed is True
    
    for phase in ["req", "code"]:
        assert engine.check_tool(phase, tool).allowed is False

def test_coding_tools_only_in_code_phase():
    """Verify apply_patch, write_file, get_diff, run_tests are allowed in code but denied in req, design."""
    engine = PolicyEngine()
    tools = ["apply_patch", "write_file", "get_diff", "run_tests"]
    
    for tool in tools:
        assert engine.check_tool("code", tool).allowed is True
        for phase in ["req", "design"]:
            assert engine.check_tool(phase, tool).allowed is False

def test_approval_tools_allowed_in_all_phases():
    """Verify request_approval, get_approval_status, get_audit_log work everywhere."""
    engine = PolicyEngine()
    tools = ["request_approval", "get_approval_status", "get_audit_log"]
    phases = ["req", "g1", "design", "g2", "code", "out"]
    
    for tool in tools:
        for phase in phases:
            assert engine.check_tool(phase, tool).allowed is True

def test_unknown_phase_rejected():
    """Verify that an invalid phase like 'invalid' is rejected."""
    engine = PolicyEngine()
    result = engine.check_tool("invalid", "read_file")
    assert result.allowed is False
    assert "Unknown phase" in result.reason

def test_unknown_tool_rejected():
    """Verify that a non-existent tool like 'shell_exec' is rejected."""
    engine = PolicyEngine()
    result = engine.check_tool("req", "shell_exec")
    assert result.allowed is False
    assert "Unknown tool" in result.reason

def test_sensitive_file_blocked():
    """Verify .env, *.pem, *.key, id_rsa are blocked for both read and write."""
    engine = PolicyEngine()
    files = [".env", "key.pem", "secret.key", "id_rsa"]
    
    for f in files:
        # Check read
        result = engine.check_file_access(f, write=False)
        assert result.allowed is False
        assert "blocked by security policy" in result.reason
        
        # Check write
        result = engine.check_file_access(f, write=True)
        assert result.allowed is False
        assert "blocked by security policy" in result.reason

def test_normal_file_allowed():
    """Verify main.py, test_app.py, README.md are allowed."""
    engine = PolicyEngine()
    files = ["main.py", "test_app.py", "README.md"]
    
    for f in files:
        assert engine.check_file_access(f, write=False).allowed is True
        assert engine.check_file_access(f, write=True).allowed is True

def test_path_traversal_blocked():
    """Verify ../../etc/passwd is blocked."""
    engine = PolicyEngine()
    result = engine.check_file_access("../../etc/passwd")
    assert result.allowed is False
    assert "Path traversal" in result.reason

def test_valid_phase_transition():
    """Verify req → g1, g1 → design, design → g2, g2 → code, code → out are all valid."""
    engine = PolicyEngine()
    transitions = [("req", "g1"), ("g1", "design"), ("design", "g2"), ("g2", "code"), ("code", "out")]
    
    for current, target in transitions:
        result = engine.check_phase_transition(current, target)
        assert result.allowed is True

def test_backward_transition_blocked():
    """Verify design → req is blocked."""
    engine = PolicyEngine()
    result = engine.check_phase_transition("design", "req")
    assert result.allowed is False
    assert "backward" in result.reason.lower()

def test_skip_transition_blocked():
    """Verify req → design (skipping g1) is blocked."""
    engine = PolicyEngine()
    result = engine.check_phase_transition("req", "design")
    assert result.allowed is False
    assert "skip phases" in result.reason.lower()
