# Test CLI operations
param([string]$Action)

switch ($Action) {
    "buffer-get" {
        .\syki.exe buffer get --json | Out-String
    }
    "buffer-set" {
        "# Injected by Agent CLI" | .\syki.exe buffer set | Out-String
    }
    "buffer-conflict" {
        "# Malicious Overwrite" | .\syki.exe buffer set --expected-hash "mismatched-hash-9999" 2>&1 | Out-String
    }
    "tab-list" {
        .\syki.exe tab list --json | Out-String
    }
    "ui-toggle-split" {
        .\syki.exe ui toggle-split | Out-String
    }
}
