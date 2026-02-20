---
description: Restart local-api-server
---

1. Find the process ID of the running `local-api-server.js` (or just kill node processes if acceptable in this env, but safer to just use `npm run api` again which usually fails if port busy, so we might need to kill first).
2. Actually, since I ran `run_command` with `node local-api-server.js`, it might be running in background.
3. The user has `npm run api` running in a terminal.
// turbo
4. Ask user to restart or try to restart if I can control the terminal. Use `taskkill /F /IM node.exe` if needed but that kills everything.
5. Best approach: Just notify user or try to kill the specific port.

Wait, I don't need a workflow file for this one-off if I can just do it. But `npm run api` is running in a terminal I don't control directly via `send_command` unless I know the ID.
The `user_information` says: `npm run api (in f:\altf-kr-web-skeleton, running for 22m25s)`.
I cannot easily restart that specific terminal.
I will use `notify_user` to ask them to restart, OR I can just run a new instance on a different port? No, port 3001 is hardcoded.

Actually, I updated the file. The `nodemon` (if used) would restart it.
Let's check `package.json` to see if `npm run api` uses `nodemon`.
