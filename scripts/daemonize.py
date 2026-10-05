#!/usr/bin/env python3
"""EdgeVision — detached process starter (classic double-fork daemonization).

Starts a command fully detached from the calling shell so it survives the
end of the tool call that launched it (the grandchild is reparented to
init, exactly like the platform's own long-running services).

Usage:
    python3 scripts/daemonize.py --cwd <workdir> --log <logfile> -- <command> [args...]

Copyright © 2026 Parsa Fathi — Apache-2.0
"""
import argparse
import os
import subprocess
import sys


def daemonize(cwd: str, log_path: str, argv: list[str]) -> int:
    # First fork: the parent exits immediately, the child is reparented to init.
    pid = os.fork()
    if pid > 0:
        # Report the intermediate child pid; the real worker pid is written to the log.
        return 0
    if pid < 0:
        print("fork() failed", file=sys.stderr)
        return 1

    os.setsid()  # new session, no controlling terminal

    # Second fork: the session leader exits so the worker can never regain a tty.
    pid = os.fork()
    if pid > 0:
        os._exit(0)
    if pid < 0:
        os._exit(1)

    os.umask(0o022)
    os.chdir(cwd)

    # Redirect stdio into the log file (append), stdin from /dev/null.
    log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.dup2(log_fd, 1)
    os.dup2(log_fd, 2)
    os.close(devnull)
    os.close(log_fd)

    print(f"[daemonize] worker pid={os.getpid()} argv={argv}", flush=True)
    os.execvp(argv[0], argv)
    return 1  # execvp only returns on failure


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cwd", default=".")
    parser.add_argument("--log", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    argv = args.command
    if argv and argv[0] == "--":
        argv = argv[1:]
    if not argv:
        parser.error("no command given")
    return daemonize(args.cwd, args.log, argv)


if __name__ == "__main__":
    sys.exit(main())
