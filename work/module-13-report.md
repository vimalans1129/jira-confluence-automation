# Module 13 Completion Report

## MCP Configuration
File: `work/mcp.json` (standard `mcpServers` format; works with Claude Desktop and other MCP clients)
```json
{
  "mcpServers": {
    "echo-windows": {
      "command": "powershell",
      "args": ["-ExecutionPolicy", "Bypass", "-File", "C:\\workspace\\hello-genai\\work\\tools\\mcp-echo.ps1"]
    },
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "[REDACTED]"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\workspace\\hello-genai\\work"]
    }
  }
}
```

The same three servers are configured for VS Code in `work/.vscode/mcp.json`, which VS Code requires to use the root key `servers` instead of `mcpServers`:
```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "github_token",
      "description": "GitHub Personal Access Token",
      "password": true
    }
  ],
  "servers": {
    "echo-windows": {
      "command": "powershell",
      "args": ["-ExecutionPolicy", "Bypass", "-File", "${workspaceFolder}/tools/mcp-echo.ps1"]
    },
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${input:github_token}"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"]
    }
  }
}
```

## Configured Servers
- echo-windows
- github
- filesystem

## MCP Tool Test
- Tool used: echo-windows-get_time
- Output:
```
2026-10-09T17:05:23.6617731+05:30
```
