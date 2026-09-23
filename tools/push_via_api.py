"""通过 GitHub REST API 推送提交（绕过 github.com:443 被拦、且本机代理未开的情况）。

原理：本机实测 `github.com` 直连超时，但 `api.github.com` 可达（200/0.4s）。
本脚本把「本地有、远端没有」的提交**逐个重放**到远端：
     blob(base64) -> tree(base_tree=父提交的 tree) -> commit(含原始 author/committer 时间戳) -> 更新 ref

★ 关键自检：若重放忠实，API 返回的 commit sha 应当与本地 sha **完全相同**。
   对不上就会立刻报错，不会静默写坏远端历史。

用法：
    uv run python tools/push_via_api.py --remote-head <远端当前 sha> <要重放的本地 sha...>
例：
    uv run python tools/push_via_api.py --remote-head 30a70da b0c5b7d 4ff4608 6a8a01c

token 取自 `gh auth token`，**绝不打印**。
"""
from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"
REPO = "Aslanilles/hermes-pet"
BRANCH = "main"


def run(*args: str) -> bytes:
    p = subprocess.run(args, capture_output=True)
    if p.returncode != 0:
        raise SystemExit(f"git 失败 {' '.join(args)}: {p.stderr.decode('utf-8', 'replace')}")
    return p.stdout


def token() -> str:
    p = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True)
    if p.returncode != 0 or not p.stdout.strip():
        raise SystemExit("拿不到 token（gh auth token 失败）")
    return p.stdout.strip()


def api(method: str, path: str, tok: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} {method} {path}\n{e.read().decode('utf-8', 'replace')[:600]}")


def meta(sha: str) -> dict:
    """直读原始提交对象（逐字节），要 100% 保留才能重放出相同 sha。

    ⚠️ 别用 `git show --format=%B`：它会给消息尾巴多补一个换行，导致提交对象字节不一致。
    """
    from datetime import datetime, timedelta, timezone

    raw = run("git", "cat-file", "commit", sha)
    head, sep, body = raw.partition(b"\n\n")
    if not sep:
        raise SystemExit(f"无法解析提交对象 {sha}")

    def person(value: str) -> dict:
        name, _, rest = value.partition(" <")
        email, _, tail = rest.partition("> ")
        ts, _, tz = tail.partition(" ")
        sign = -1 if tz.startswith("-") else 1
        offset = timedelta(hours=sign * int(tz[1:3]), minutes=sign * int(tz[3:5]))
        when = datetime.fromtimestamp(int(ts), timezone(offset)).isoformat()
        return {"name": name, "email": email, "date": when}

    fields: dict[str, str] = {}
    parents: list[str] = []
    for line in head.decode("utf-8").splitlines():
        key, _, value = line.partition(" ")
        if key == "parent":
            parents.append(value)
        else:
            fields[key] = value

    return {
        "author": person(fields["author"]),
        "committer": person(fields["committer"]),
        "parents": parents,
        "message": body.decode("utf-8"),   # 逐字节
    }


def modes(sha: str) -> dict[str, str]:
    """提交里每个文件的真实 mode（100644 / 100755 / 120000），别硬编码。"""
    out = run("git", "ls-tree", "-r", sha).decode("utf-8")
    table: dict[str, str] = {}
    for line in out.splitlines():
        info, _, path = line.partition("\t")
        table[path] = info.split()[0]
    return table


def changed(parent: str, sha: str) -> list[tuple[str, str]]:
    out = run("git", "diff", "--name-status", parent, sha).decode("utf-8")
    rows: list[tuple[str, str]] = []
    for line in out.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        rows.append((parts[0][0], parts[-1]))  # A / M / D
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote-head", required=True, help="远端当前 main 的 sha（重放的起点）")
    ap.add_argument("shas", nargs="+", help="要重放的本地提交（从旧到新）")
    args = ap.parse_args()

    tok = token()
    print(f"token 已加载（长度 {len(tok)}，不显示）")

    remote_sha = api("GET", f"/repos/{REPO}/commits/{args.remote_head}", tok)["sha"]
    base_tree = api("GET", f"/repos/{REPO}/commits/{args.remote_head}", tok)["commit"]["tree"]["sha"]
    print(f"远端起点 {remote_sha[:7]}  tree={base_tree[:7]}")

    for sha in args.shas:
        full = run("git", "rev-parse", sha).decode().strip()
        m = meta(full)
        parent = m["parents"][0]
        if parent != remote_sha:
            raise SystemExit(
                f"链不连续：{sha[:7]} 的父提交是 {parent[:7]}，但远端当前是 {remote_sha[:7]}；"
                "请按从旧到新的顺序传参"
            )
        files = changed(parent, full)
        file_modes = modes(full)
        entries = []
        for st, path in files:
            mode = file_modes.get(path, "100644")
            if st == "D":
                entries.append({"path": path, "mode": mode, "type": "blob", "sha": None})
                print(f"  删除 {path}")
                continue
            content = run("git", "show", f"{full}:{path}")
            blob = api("POST", f"/repos/{REPO}/git/blobs", tok, {
                "content": base64.b64encode(content).decode(),
                "encoding": "base64",
            })
            entries.append({"path": path, "mode": mode, "type": "blob", "sha": blob["sha"]})
            print(f"  {st} {mode} {path}  {len(content)}B")

        tree = api("POST", f"/repos/{REPO}/git/trees", tok,
                   {"base_tree": base_tree, "tree": entries})
        commit = api("POST", f"/repos/{REPO}/git/commits", tok, {
            "message": m["message"],
            "tree": tree["sha"],
            "parents": [remote_sha],
            "author": m["author"],
            "committer": m["committer"],
        })
        ok = commit["sha"] == full
        print(f"提交 {full[:7]} -> 远端 {commit['sha'][:7]}  {'✅ sha 一致' if ok else '❌ sha 不一致'}")
        if not ok:
            raise SystemExit(
                "重放出的 sha 与本地不一致 —— 说明元数据没逐字保留。已停止，远端 ref 未改动。"
            )
        remote_sha, base_tree = commit["sha"], tree["sha"]

    api("PATCH", f"/repos/{REPO}/git/refs/heads/{BRANCH}", tok, {"sha": remote_sha, "force": False})
    head = api("GET", f"/repos/{REPO}/commits/{BRANCH}", tok)
    print(f"\n远端 {BRANCH} 现在 = {head['sha'][:7]}  ({head['commit']['committer']['date']})")
    print(f"本地 HEAD        = {run('git', 'rev-parse', 'HEAD').decode().strip()[:7]}")


if __name__ == "__main__":
    sys.exit(main())
