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

def test_get_phase_permissions_for_req_and_code():
    """Verify get_phase_permissions accurately partitions allowed and denied tools per phase."""
    engine = PolicyEngine()
    
    req_perms = engine.get_phase_permissions("req")
    assert "submit_requirements" in req_perms["allowed_tools"]
    assert "apply_patch" in req_perms["denied_tools"]
    assert "run_tests" in req_perms["denied_tools"]
    
    code_perms = engine.get_phase_permissions("code")
    assert "apply_patch" in code_perms["allowed_tools"]
    assert "run_tests" in code_perms["allowed_tools"]
    assert "submit_requirements" in code_perms["denied_tools"]

def test_get_phase_permissions_invalid_phase():
    """Verify get_phase_permissions raises ValueError on invalid phase."""
    engine = PolicyEngine()
    with pytest.raises(ValueError, match="Unknown phase"):
        engine.get_phase_permissions("unknown_phase")




# ── D1: git metadata is off limits ───────────────────────────────────────

@pytest.mark.parametrize("path", [".git/config", ".git/hooks/pre-commit", "sub/.git/config", ".GIT/config", ".git"])
def test_git_metadata_is_blocked(path):
    engine = PolicyEngine()
    assert engine.check_file_access(path, write=True).allowed is False
    assert engine.check_file_access(path, write=False).allowed is False


@pytest.mark.parametrize("path", [".gitignore", ".github/workflows/ci.yml", "src/git_utils.py"])
def test_git_lookalike_names_are_allowed(path):
    assert PolicyEngine().check_file_access(path, write=True).allowed is True


@pytest.mark.parametrize("path", ["a\\..\\b.py", "sub\\.env"])
def test_backslash_paths_are_checked_like_slash_paths(path):
    assert PolicyEngine().check_file_access(path).allowed is False


# ── B0: no active phase means deny, not "requirements" ──────────────────

def _steps(*states):
    keys = ["req", "g1", "design", "g2", "code", "out"]
    return {"steps": [{"key": k, "state": s} for k, s in zip(keys, states)]}


def test_current_phase_is_the_active_step():
    run = _steps("approved", "approved", "active", "pending", "pending", "pending")
    assert PolicyEngine.current_phase(run) == "design"


def test_current_phase_of_a_fresh_run_is_requirements():
    run = _steps("pending", "pending", "pending", "pending", "pending", "pending")
    assert PolicyEngine.current_phase(run) == "req"


@pytest.mark.parametrize("states", [
    ("approved", "approved", "approved", "rejected", "pending", "pending"),   # rejected at Gate 2
    ("approved", "approved", "approved", "approved", "approved", "approved"), # finished
])
def test_current_phase_of_a_rejected_or_finished_run_is_none(states):
    # Before B0 these fell back to "req", which let the agent resubmit
    # requirements and later skip the rejected design.
    assert PolicyEngine.current_phase(_steps(*states)) is None


def test_current_phase_of_a_malformed_run_is_none():
    assert PolicyEngine.current_phase({}) is None
    assert PolicyEngine.current_phase({"steps": []}) is None
