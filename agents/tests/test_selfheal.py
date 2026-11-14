from app.selfheal import failing, self_heal


def result(failed, **extra):
    return {"passed": 3 - failed, "failed": failed, "total": 3, "output": f"{failed} failed", **extra}


def test_self_heal_recovers_after_a_fix():
    runs, fixes = [], []

    def run_tests(i):
        runs.append(i)
        return result(0 if fixes else 1)

    out = self_heal(run_tests, fix=fixes.append, max_iterations=3)
    assert out["failed"] == 0
    assert out["iterations"] == 1   # one repair round
    assert runs == [0, 1]           # each run knows its round
    assert fixes[0]["output"] == "1 failed"  # the fix sees the failing output


def test_self_heal_gives_up_after_max_iterations():
    out = self_heal(lambda i: result(1), fix=lambda r: None, max_iterations=3)
    assert out["failed"] > 0
    assert out["iterations"] == 3


def test_a_sandbox_error_is_not_retried():
    calls = []
    out = self_heal(lambda i: result(1, sandbox_error=True), fix=calls.append)
    assert out["iterations"] == 0 and calls == []
    assert failing(result(1)) and not failing(result(0))
