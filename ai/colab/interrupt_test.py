"""Prove the notebook resumes an interrupted run: kill it mid-training, run again.

Starts run_notebook_local.py fresh with 3 epochs, kills the whole process tree
once epoch 1 is in results.csv (as a Colab disconnect would), then reruns with
--keep and checks that training resumed and finished all 3 epochs.

Usage (from ai/colab): ../.venv-gpu/Scripts/python interrupt_test.py
"""
import csv
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUN = HERE.parent / "runs" / "colab-smoke" / "runs" / "yolo11s-india-ft-colab"
LOG = HERE.parent / "runs" / "colab-smoke"


def rows() -> int:
    try:
        with open(RUN / "results.csv") as f:
            return sum(1 for _ in csv.DictReader(f))
    except FileNotFoundError:
        return 0


def main() -> None:
    # The previous run's results.csv would read as "epoch 1 done" before this one starts.
    shutil.rmtree(RUN, ignore_errors=True)
    with open(LOG / "interrupt-1.log", "w") as out:
        p = subprocess.Popen([sys.executable, "run_notebook_local.py", "3"], cwd=HERE, stdout=out,
                             stderr=subprocess.STDOUT)
        while p.poll() is None and rows() < 1:
            time.sleep(2)
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], capture_output=True)
        p.wait()
    print(f"killed after {rows()} epoch(s)")
    assert rows() == 1, "expected to interrupt after exactly 1 epoch"

    with open(LOG / "interrupt-2.log", "w") as out:
        code = subprocess.run([sys.executable, "run_notebook_local.py", "3", "--keep"], cwd=HERE,
                              stdout=out, stderr=subprocess.STDOUT).returncode
    log = (LOG / "interrupt-2.log").read_text(errors="replace")
    print(f"rerun exit {code}, epochs in results.csv: {rows()}")
    assert code == 0, "rerun failed; see interrupt-2.log"
    assert "resuming yolo11s-india-ft-colab after epoch 1" in log, "rerun did not resume"
    assert rows() == 3, "resumed run did not finish all 3 epochs"
    assert (RUN / "REPORT.md").exists()
    print("PASS: interrupted run resumed from epoch 1 and finished 3 of 3")


if __name__ == "__main__":
    main()
