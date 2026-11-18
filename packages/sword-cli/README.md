# @curvenote/sword-cli

The `meca-sword` command: build and inspect MECA packages, and deposit them at any SWORD v3 server.

```bash
meca-sword build <files or folders...> [-o out-meca.zip]
meca-sword inspect <file.zip>
meca-sword example [file.zip]
meca-sword send <file.zip> <serviceUrl> [-k apiKey | -u user -p pass] [--slug id] [--wait]
meca-sword status <objectUrl> [-k apiKey | -u user -p pass]
meca-sword service <serviceUrl> [-k apiKey | -u user -p pass]
```

Credentials can also come from `SWORD_API_KEY`, or `SWORD_USERNAME` and `SWORD_PASSWORD`.
