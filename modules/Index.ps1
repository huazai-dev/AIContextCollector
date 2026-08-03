<#
.SYNOPSIS
    索引构建模块
#>

# ============================================================
# 构建索引
# ============================================================

function Build-ProjectIndex {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectPath,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    if (-not (Test-Path $ProjectPath -PathType Container)) {
        Write-Error2 "目录不存在: $ProjectPath"
        return $null
    }

    $resolvedPath = (Resolve-Path $ProjectPath).Path

    Write-Host ""
    Write-Title "  开始扫描项目目录..."
    Write-Info  "  路径: $resolvedPath"
    Write-Host ""

    $supportedExtensions = $Config.index.supportedExtensions
    $ignoredDirectories  = $Config.index.ignoredDirectories
    $maxFileSizeKB       = $Config.index.maxFileSizeKB

    $stopwatch    = [System.Diagnostics.Stopwatch]::StartNew()
    $files        = [System.Collections.ArrayList]::new()
    $scannedCount = 0
    $skippedCount = 0

    $allFiles = Get-ChildItem -Path $resolvedPath -Recurse -File -ErrorAction SilentlyContinue

    foreach ($file in $allFiles) {

        $scannedCount++

        if ($scannedCount % 200 -eq 0) {
            Write-Host "`r  已扫描 $scannedCount 个文件..." -NoNewline
        }

        # --- 检查是否在忽略目录中 ---
        $relativePath = Get-RelativePath -FullPath $file.FullName -BasePath $resolvedPath
        $shouldIgnore = $false

        $pathParts = $relativePath.Split('/')
        foreach ($part in $pathParts) {
            if ($ignoredDirectories -contains $part) {
                $shouldIgnore = $true
                break
            }
        }

        if ($shouldIgnore) {
            $skippedCount++
            continue
        }

        # --- 检查扩展名 ---
        $ext = $file.Extension.ToLower()
        if ($ext -notin $supportedExtensions) {
            $skippedCount++
            continue
        }

        # --- 检查文件大小 ---
        $fileSizeKB = $file.Length / 1024
        if ($fileSizeKB -gt $maxFileSizeKB) {
            $skippedCount++
            continue
        }

        # --- 添加到索引 ---
        $entry = [PSCustomObject]@{
            fileName     = $file.Name
            relativePath = $relativePath
            fullPath     = $file.FullName
            extension    = $ext
            fileSize     = $file.Length
            lastModified = $file.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
        }

        [void]$files.Add($entry)
    }

    # 清除进度行
    Write-Host "`r                                    `r" -NoNewline

    $stopwatch.Stop()

    $projectName = Split-Path $resolvedPath -Leaf

    $index = [PSCustomObject]@{
        projectName = $projectName
        projectPath = $resolvedPath
        totalFiles  = $files.Count
        createdAt   = Get-Timestamp
        scanTimeMs  = $stopwatch.ElapsedMilliseconds
        files       = $files.ToArray()
    }

    Write-ProgressStep -StepName "扫描完成" -Status "OK"
    Write-Info "  总扫描: $scannedCount 个文件"
    Write-Info "  已索引: $($files.Count) 个文件"
    Write-Info "  已跳过: $skippedCount 个文件"
    Write-Info "  耗时  : $($stopwatch.ElapsedMilliseconds) ms"

    return $index
}

# ============================================================
# 保存索引
# ============================================================

function Save-ProjectIndex {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Index,

        [Parameter(Mandatory = $true)]
        [string]$CachePath
    )

    Ensure-Directory -Path $CachePath

    $indexFile = Join-Path $CachePath "index.json"

    try {
        $Index | ConvertTo-Json -Depth 10 | Out-File -FilePath $indexFile -Encoding UTF8 -Force
        $fileSize = Format-FileSize -SizeInBytes (Get-Item $indexFile).Length
        Write-ProgressStep -StepName "索引已保存" -Status "$indexFile ($fileSize)"
        return $true
    }
    catch {
        Write-Error2 "保存索引失败: $_"
        return $false
    }
}

# ============================================================
# 加载索引
# ============================================================

function Load-ProjectIndex {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CachePath
    )

    $indexFile = Join-Path $CachePath "index.json"

    if (-not (Test-Path $indexFile)) {
        return $null
    }

    try {
        $jsonContent = Get-Content -Path $indexFile -Raw -Encoding UTF8
        $index = $jsonContent | ConvertFrom-Json
        return $index
    }
    catch {
        Write-Error2 "加载索引失败: $_"
        return $null
    }
}

# ============================================================
# 显示索引信息
# ============================================================

function Show-IndexInfo {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Index
    )

    Write-Host ""
    Write-Separator
    Write-Title "  索引信息"
    Write-Separator
    Write-Host ""
    Write-Info "  项目名称: $($Index.projectName)"
    Write-Info "  项目路径: $($Index.projectPath)"
    Write-Info "  文件总数: $($Index.totalFiles)"
    Write-Info "  创建时间: $($Index.createdAt)"
    Write-Info "  扫描耗时: $($Index.scanTimeMs) ms"
    Write-Host ""

    if ($Index.files -and $Index.files.Count -gt 0) {

        Write-Title "  文件类型分布:"
        Write-Host ""

        $extGroups = $Index.files |
            Group-Object -Property extension |
            Sort-Object  -Property Count -Descending

        foreach ($group in $extGroups) {
            $barLen = [math]::Min($group.Count, 30)
            $bar    = "#" * $barLen
            Write-ColorText -Text "    $($group.Name.PadRight(15))" -Color "Cyan"  -NoNewline
            Write-ColorText -Text "$($group.Count.ToString().PadLeft(6)) " -Color "White" -NoNewline
            Write-ColorText -Text $bar -Color "DarkCyan"
        }
    }

    Write-Host ""
}