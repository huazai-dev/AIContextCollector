<#
.SYNOPSIS
    Markdown生成模块
.DESCRIPTION
    将收集到的文件生成统一格式的Markdown文档
#>

# ============================================================
# 生成Markdown内容
# ============================================================

function Build-MarkdownContent {
    <#
    .SYNOPSIS
        根据文件列表生成Markdown内容
    .PARAMETER Files
        已确认的文件索引条目数组
    .PARAMETER ProjectName
        项目名称
    .PARAMETER SourceLabel
        内容来源说明（可选），例如 "目录 src/main/java/service (含子目录)"
    .OUTPUTS
        Markdown字符串
    #>
    param(
        [Parameter(Mandatory = $true)]
        [array]$Files,

        [Parameter(Mandatory = $true)]
        [string]$ProjectName,

        [Parameter(Mandatory = $false)]
        [string]$SourceLabel = ""
    )

    $sb = [System.Text.StringBuilder]::new()

    # ---- 标题 ----
    [void]$sb.AppendLine("# AI Context")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("项目: $ProjectName")
    [void]$sb.AppendLine("")

    if (-not [string]::IsNullOrWhiteSpace($SourceLabel)) {
        [void]$sb.AppendLine("来源: $SourceLabel")
        [void]$sb.AppendLine("")
    }
    [void]$sb.AppendLine("生成时间: $(Get-Timestamp)")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("文件数量: $($Files.Count)")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("========================================")
    [void]$sb.AppendLine("")

    # ---- 文件列表目录 ----
    [void]$sb.AppendLine("## 文件列表")
    [void]$sb.AppendLine("")

    $fileIndex = 1
    foreach ($file in $Files) {
        [void]$sb.AppendLine("${fileIndex}. ``$($file.relativePath)``")
        $fileIndex++
    }

    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("========================================")
    [void]$sb.AppendLine("")

    # ---- 文件内容 ----
    $fileIndex = 1
    foreach ($file in $Files) {
        $language = Get-FileExtensionLanguage -Extension $file.extension

        [void]$sb.AppendLine("## 文件 ${fileIndex}: $($file.relativePath)")
        [void]$sb.AppendLine("")

        # 读取文件内容
        $fileContent = Read-FileContentSafe -FilePath $file.fullPath

        if ($null -ne $fileContent) {
            [void]$sb.AppendLine("``````$language")
            [void]$sb.AppendLine($fileContent)
            [void]$sb.AppendLine("``````")
        }
        else {
            [void]$sb.AppendLine("> ⚠️ 无法读取文件内容")
        }

        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("========================================")
        [void]$sb.AppendLine("")

        $fileIndex++
    }

    return $sb.ToString()
}

# ============================================================
# 安全读取文件
# ============================================================

function Read-FileContentSafe {
    <#
    .SYNOPSIS
        安全读取文件内容，处理编码问题
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath
    )

    if (-not (Test-Path $FilePath)) {
        Write-Warning "文件不存在: $FilePath"
        return $null
    }

    try {
        # 尝试UTF-8读取
        $content = Get-Content -Path $FilePath -Raw -Encoding UTF8 -ErrorAction Stop

        # 移除BOM
        if ($content -and $content.Length -gt 0 -and $content[0] -eq [char]0xFEFF) {
            $content = $content.Substring(1)
        }

        # 移除末尾多余换行
        $content = $content.TrimEnd("`r", "`n")

        return $content
    }
    catch {
        try {
            # 回退到默认编码
            $content = Get-Content -Path $FilePath -Raw -ErrorAction Stop
            $content = $content.TrimEnd("`r", "`n")
            return $content
        }
        catch {
            Write-Error2 "读取文件失败: $FilePath - $_"
            return $null
        }
    }
}

# ============================================================
# 保存Markdown文件
# ============================================================

function Save-MarkdownOutput {
    <#
    .SYNOPSIS
        保存Markdown到output目录
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content,

        [Parameter(Mandatory = $true)]
        [string]$OutputDir,

        [Parameter(Mandatory = $false)]
        [string]$FileName = "last.md"
    )

    Ensure-Directory -Path $OutputDir

    $outputFile = Join-Path $OutputDir $FileName

    try {
        $Content | Out-File -FilePath $outputFile -Encoding UTF8 -Force

        $fileSize = Format-FileSize -SizeInBytes (Get-Item $outputFile).Length
        Write-ProgressStep -StepName "Markdown已保存" -Status "$outputFile ($fileSize)"

        return $outputFile
    }
    catch {
        Write-Error2 "保存Markdown失败: $_"
        return $null
    }
}