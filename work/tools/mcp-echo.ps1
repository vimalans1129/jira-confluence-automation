# Minimal MCP server (stdio, newline-delimited JSON-RPC) exposing an "echo" tool.
$ErrorActionPreference = 'Stop'

$utf8 = New-Object System.Text.UTF8Encoding($false)
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true
$stdout.NewLine = "`n"

function Send($obj) {
    $stdout.WriteLine(($obj | ConvertTo-Json -Compress -Depth 10))
}

function Reply($id, $result) {
    Send ([ordered]@{ jsonrpc = '2.0'; id = $id; result = $result })
}

function Fail($id, $code, $message) {
    Send ([ordered]@{ jsonrpc = '2.0'; id = $id; error = [ordered]@{ code = [int]$code; message = $message } })
}

while ($null -ne ($line = $stdin.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
        $msg = $line | ConvertFrom-Json
    } catch {
        Fail $null -32700 'Parse error'
        continue
    }

    $hasId = $msg.PSObject.Properties.Name -contains 'id'

    switch ($msg.method) {
        'initialize' {
            Reply $msg.id ([ordered]@{
                protocolVersion = if ($msg.params.protocolVersion) { $msg.params.protocolVersion } else { '2024-11-05' }
                capabilities    = [ordered]@{ tools = [ordered]@{} }
                serverInfo      = [ordered]@{ name = 'echo-windows'; version = '1.0.0' }
            })
        }
        'ping' { Reply $msg.id ([ordered]@{}) }
        'tools/list' {
            Reply $msg.id ([ordered]@{
                tools = @(
                    [ordered]@{
                        name        = 'echo'
                        description = 'Echoes the given message back.'
                        inputSchema = [ordered]@{
                            type       = 'object'
                            properties = [ordered]@{
                                message = [ordered]@{ type = 'string'; description = 'Message to echo' }
                            }
                            required   = @('message')
                        }
                    },
                    [ordered]@{
                        name        = 'get_time'
                        description = 'Returns the current timestamp in ISO 8601 format.'
                        inputSchema = [ordered]@{ type = 'object'; properties = [ordered]@{} }
                    },
                    [ordered]@{
                        name        = 'calculate'
                        description = 'Performs an arithmetic operation on two numbers.'
                        inputSchema = [ordered]@{
                            type       = 'object'
                            properties = [ordered]@{
                                operation = [ordered]@{
                                    type        = 'string'
                                    enum        = @('add', 'subtract', 'multiply', 'divide', 'modulo', 'power')
                                    description = 'Operation to perform'
                                }
                                a         = [ordered]@{ type = 'number'; description = 'First operand' }
                                b         = [ordered]@{ type = 'number'; description = 'Second operand' }
                            }
                            required   = @('operation', 'a', 'b')
                        }
                    }
                )
            })
        }
        'tools/call' {
            $toolArgs = $msg.params.arguments
            $text = $null
            $isError = $false

            switch ($msg.params.name) {
                'echo' { $text = "Echo: $($toolArgs.message)" }
                'get_time' { $text = (Get-Date).ToString('o') }
                'calculate' {
                    $a = $null; $b = $null
                    if (-not ([double]::TryParse([string]$toolArgs.a, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$a)) -or
                        -not ([double]::TryParse([string]$toolArgs.b, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$b))) {
                        $text = 'Error: a and b must be numbers.'; $isError = $true
                    } else {
                        switch ($toolArgs.operation) {
                            'add' { $r = $a + $b }
                            'subtract' { $r = $a - $b }
                            'multiply' { $r = $a * $b }
                            'divide' { if ($b -eq 0) { $isError = $true; $text = 'Error: division by zero.' } else { $r = $a / $b } }
                            'modulo' { if ($b -eq 0) { $isError = $true; $text = 'Error: division by zero.' } else { $r = $a % $b } }
                            'power' { $r = [math]::Pow($a, $b) }
                            default { $isError = $true; $text = "Error: unknown operation '$($toolArgs.operation)'." }
                        }
                        if (-not $isError) { $text = [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0}', $r) }
                    }
                }
            }

            if ($null -eq $text) {
                Fail $msg.id -32602 "Unknown tool: $($msg.params.name)"
            } else {
                Reply $msg.id ([ordered]@{
                    content = @([ordered]@{ type = 'text'; text = $text })
                    isError = $isError
                })
            }
        }
        default {
            if ($hasId) { Fail $msg.id -32601 "Method not found: $($msg.method)" }
        }
    }
}
