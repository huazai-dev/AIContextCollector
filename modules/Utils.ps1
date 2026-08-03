<#
.SYNOPSIS
    工具函数模块
#>

# ============================================================
# 配置加载
# ============================================================

function Get-AppConfig {
    param(
        [Parameter(Mandatory = $false)]
        [string]$ConfigPath
    )

    if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        $ConfigPath = Join-Path $script:AppRoot "config.json"
    }

    if (-not (Test-Path $ConfigPath)) {
        throw "config file not found: $ConfigPath"
    }

    try {
        $raw = Get-Content -Path $ConfigPath -Raw -Encoding UTF8
        $cfg = $raw | ConvertFrom-Json
        return $cfg
    }
    catch {
        throw "config parse failed: $_"
    }
}

# ============================================================
# 路径工具
# ============================================================

function Get-NormalizedPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return $Path.Replace('\', '/')
}

function Get-RelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FullPath,

        [Parameter(Mandatory = $true)]
        [string]$BasePath
    )

    $normalizedFull = [System.IO.Path]::GetFullPath($FullPath)
    $normalizedBase = [System.IO.Path]::GetFullPath($BasePath)

    if (-not $normalizedBase.EndsWith('\') -and -not $normalizedBase.EndsWith('/')) {
        $normalizedBase += '\'
    }

    if ($normalizedFull.StartsWith($normalizedBase, [System.StringComparison]::OrdinalIgnoreCase)) {
        $relative = $normalizedFull.Substring($normalizedBase.Length)
    }
    else {
        $relative = $normalizedFull
    }

    $relative = $relative.Replace('\', '/')
    $relative = $relative.Trim('/')

    return $relative
}

function Get-FileExtensionLanguage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Extension
    )

    $languageMap = @{
        '.java'       = 'java'
        '.xml'        = 'xml'
        '.vue'        = 'vue'
        '.js'         = 'javascript'
        '.ts'         = 'typescript'
        '.json'       = 'json'
        '.sql'        = 'sql'
        '.yml'        = 'yaml'
        '.yaml'       = 'yaml'
        '.properties' = 'properties'
        '.md'         = 'markdown'
        '.html'       = 'html'
        '.css'        = 'css'
        '.scss'       = 'scss'
        '.less'       = 'less'
        '.sh'         = 'bash'
        '.bat'        = 'batch'
        '.ps1'        = 'powershell'
        '.py'         = 'python'
        '.go'         = 'go'
        '.rs'         = 'rust'
        '.kt'         = 'kotlin'
        '.gradle'     = 'gradle'
        '.toml'       = 'toml'
        '.ini'        = 'ini'
        '.jsx'        = 'jsx'
        '.tsx'        = 'tsx'
    }

    $ext = $Extension.ToLower()
    if ($languageMap.ContainsKey($ext)) {
        return $languageMap[$ext]
    }

    return 'text'
}

# ============================================================
# 文件大小格式化
# ============================================================

function Format-FileSize {
    param(
        [Parameter(Mandatory = $true)]
        [long]$SizeInBytes
    )

    if ($SizeInBytes -lt 1024) {
        return "$SizeInBytes B"
    }
    elseif ($SizeInBytes -lt 1048576) {
        $kb = [math]::Round($SizeInBytes / 1024, 2)
        return "$kb KB"
    }
    else {
        $mb = [math]::Round($SizeInBytes / 1048576, 2)
        return "$mb MB"
    }
}

# ============================================================
# 目录工具
# ============================================================

function Ensure-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

# ============================================================
# 时间戳
# ============================================================

function Get-Timestamp {
    param(
        [Parameter(Mandatory = $false)]
        [string]$Format = "yyyy-MM-dd HH:mm:ss"
    )

    return (Get-Date).ToString($Format)
}

# ============================================================
# 字符串工具
# ============================================================

function Test-IsNullOrWhiteSpace {
    param(
        [Parameter(Mandatory = $false)]
        [string]$Value
    )

    return [string]::IsNullOrWhiteSpace($Value)
}