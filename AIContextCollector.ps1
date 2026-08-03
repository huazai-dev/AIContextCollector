<#
.SYNOPSIS
    AI Context Collector - Main Entry
.VERSION
    1.0.0
#>

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8

$script:AppRoot = $PSScriptRoot

# ============================================================
# 加载模块（逐个加载，出错立即提示）
# ============================================================

$moduleFiles = @(
    "modules\Utils.ps1",
    "modules\Console.ps1",
    "modules\Index.ps1",
    "modules\Search.ps1",
    "modules\Markdown.ps1",
    "modules\Clipboard.ps1"
)

foreach ($mf in $moduleFiles) {
    $mp = Join-Path $script:AppRoot $mf
    if (-not (Test-Path $mp)) {
        Write-Host "Module not found: $mp" -ForegroundColor Red
        exit 1
    }
    try {
        . $mp
    }
    catch {
        Write-Host "Module load failed: $mf" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Red
        exit 1
    }
}

# ============================================================
# 加载配置
# ============================================================

try {
    $script:Config = Get-AppConfig
}
catch {
    Write-Host "Config load failed: $_" -ForegroundColor Red
    exit 1
}

# ============================================================
# 全局状态
# ============================================================

$script:CurrentIndex       = $null
$script:CurrentProjectPath = ""
$script:CachePath          = Join-Path $script:AppRoot $script:Config.output.cacheDir
$script:OutputPath         = Join-Path $script:AppRoot $script:Config.output.outputDir

Ensure-Directory -Path $script:CachePath
Ensure-Directory -Path $script:OutputPath

# ============================================================
# 功能 1: 设置项目目录
# ============================================================

function Invoke-SetProjectDirectory {

    Write-Host ""
    $projectDir = Read-UserInput -Prompt "  请输入项目目录路径 > "

    if (Test-IsNullOrWhiteSpace -Value $projectDir) {
        Write-Warning2 "  未输入路径"
        return
    }

    $projectDir = $projectDir.Trim('"', "'", ' ')

    if (-not (Test-Path $projectDir -PathType Container)) {
        Write-Error2 "  目录不存在: $projectDir"
        return
    }

    $script:CurrentProjectPath = (Resolve-Path $projectDir).Path

    $idx = Build-ProjectIndex -ProjectPath $script:CurrentProjectPath -Config $script:Config

    if ($null -ne $idx) {
        $script:CurrentIndex = $idx
        Save-ProjectIndex -Index $idx -CachePath $script:CachePath
        Write-Host ""
        Write-Success "  项目索引建立完成!"
    }
}

# ============================================================
# 功能 2: 粘贴 GPT 内容并生成上下文
# ============================================================

function Invoke-PasteAndGenerate {

    if ($null -eq $script:CurrentIndex) {
        Write-Error2 "  请先设置项目目录 (选项 1)"
        return
    }

    Write-Host ""
    Write-Title "  粘贴 GPT/AI 返回的内容"
    Write-Info  "  工具会自动提取文件名并搜索"
    Write-Host ""
    Write-ColorText -Text "  [1] " -Color "Cyan" -NoNewline
    Write-Info "从剪贴板读取"
    Write-ColorText -Text "  [2] " -Color "Cyan" -NoNewline
    Write-Info "手动粘贴输入"
    Write-Host ""
    Write-ColorText -Text "  请选择 > " -Color "Green" -NoNewline

    $inputChoice = Read-Host
    $gptContent  = ""

    if ($inputChoice.Trim() -eq "1") {

        $gptContent = Get-FromClipboard

        if ([string]::IsNullOrWhiteSpace($gptContent)) {
            Write-Warning2 "  剪贴板为空"
            return
        }

        Write-Success "  已从剪贴板读取内容"
        Write-Host ""
        Write-ColorText -Text "  --- 内容预览 ---" -Color "DarkGray"

        $previewLines = ($gptContent -split "`n") | Select-Object -First 5
        foreach ($pl in $previewLines) {
            Write-ColorText -Text "  $pl" -Color "DarkGray"
        }

        $totalLines = ($gptContent -split "`n").Count
        if ($totalLines -gt 5) {
            Write-ColorText -Text "  ... (更多内容省略)" -Color "DarkGray"
        }

        Write-ColorText -Text "  --- 预览结束 ---" -Color "DarkGray"
        Write-Host ""
    }
    else {

        $gptContent = Read-MultiLineInput -Prompt "  请粘贴 GPT/AI 返回的内容:"

        if ([string]::IsNullOrWhiteSpace($gptContent)) {
            Write-Warning2 "  未输入内容"
            return
        }
    }

    # 提取文件名
    Write-Host ""
    Write-Title "  解析文件名..."

    $extractedFiles = Extract-FileNames -Content $gptContent

    if ($extractedFiles.Count -eq 0) {
        Write-Error2 "  未能从内容中提取到任何文件名"
        return
    }

    Write-Host ""
    Write-Success "  提取到 $($extractedFiles.Count) 个文件名:"

    foreach ($ef in $extractedFiles) {
        Write-ColorText -Text "    * " -Color "Cyan" -NoNewline
        Write-Info $ef
    }

    Write-Host ""
    $confirmed = Read-Confirmation -Message "是否继续搜索并生成?" -DefaultYes $true
    if (-not $confirmed) {
        Write-Info "  已取消"
        return
    }

    # 搜索文件
    $resolvedFiles = Search-FilesWithResolution `
        -FileNames $extractedFiles `
        -Index     $script:CurrentIndex

    if ($resolvedFiles.Count -eq 0) {
        Write-Error2 "  没有找到任何匹配文件"
        return
    }

    Write-Host ""
    $confirmed = Read-Confirmation `
        -Message "确认生成 $($resolvedFiles.Count) 个文件的上下文?" `
        -DefaultYes $true

    if (-not $confirmed) {
        Write-Info "  已取消"
        return
    }

    # 生成 Markdown
    Write-Host ""
    Write-Title "  生成 Markdown..."

    $mdContent = Build-MarkdownContent `
        -Files       $resolvedFiles `
        -ProjectName $script:CurrentIndex.projectName

    $outFile = Save-MarkdownOutput `
        -Content   $mdContent `
        -OutputDir $script:OutputPath `
        -FileName  $script:Config.output.defaultFileName

    Copy-ToClipboard -Text $mdContent

    $totalSize = 0
    foreach ($f in $resolvedFiles) { $totalSize += $f.fileSize }

    Write-Host ""
    Write-Separator -Char "=" -Length 60 -Color "Green"
    Write-Success "  生成完成!"
    Write-Info    "  文件数量: $($resolvedFiles.Count)"
    Write-Info    "  总大小  : $(Format-FileSize -SizeInBytes $totalSize)"
    Write-Info    "  字符数  : $($mdContent.Length)"
    Write-Info    "  输出文件: $outFile"
    Write-Success "  已复制到剪贴板!"
    Write-Separator -Char "=" -Length 60 -Color "Green"
}

# ============================================================
# 功能 3: 手动搜索
# ============================================================

function Invoke-ManualSearchMode {

    if ($null -eq $script:CurrentIndex) {
        Write-Error2 "  请先设置项目目录 (选项 1)"
        return
    }

    Invoke-ManualSearch -Index $script:CurrentIndex
}

# ============================================================
# 功能 4: 查看索引信息
# ============================================================

function Invoke-ShowIndex {

    if ($null -eq $script:CurrentIndex) {

        $cached = Load-ProjectIndex -CachePath $script:CachePath

        if ($null -ne $cached) {
            $script:CurrentIndex       = $cached
            $script:CurrentProjectPath = $cached.projectPath
        }
        else {
            Write-Error2 "  没有可用的索引"
            return
        }
    }

    Show-IndexInfo -Index $script:CurrentIndex
}

# ============================================================
# 功能 5: 重建索引
# ============================================================

function Invoke-RebuildIndex {

    if ([string]::IsNullOrWhiteSpace($script:CurrentProjectPath)) {
        Write-Warning2 "  请先设置项目目录 (选项 1)"
        return
    }

    Write-Host ""
    $confirmed = Read-Confirmation `
        -Message "确认重建索引 [$script:CurrentProjectPath]?" `
        -DefaultYes $true

    if (-not $confirmed) { return }

    $idx = Build-ProjectIndex `
        -ProjectPath $script:CurrentProjectPath `
        -Config      $script:Config

    if ($null -ne $idx) {
        $script:CurrentIndex = $idx
        Save-ProjectIndex -Index $idx -CachePath $script:CachePath
        Write-Host ""
        Write-Success "  索引重建完成!"
    }
}

# ============================================================
# 初始化：加载缓存
# ============================================================

function Initialize-FromCache {

    $cached = Load-ProjectIndex -CachePath $script:CachePath

    if ($null -ne $cached) {
        $script:CurrentIndex       = $cached
        $script:CurrentProjectPath = $cached.projectPath
        Write-Info "  已加载缓存索引: $($cached.projectName) ($($cached.totalFiles) files)"
    }
}

# ============================================================
# 主循环
# ============================================================

function Start-MainLoop {

    Show-Banner
    Initialize-FromCache

    while ($true) {

        if (-not [string]::IsNullOrWhiteSpace($script:CurrentProjectPath)) {
            $displayProject = "$($script:CurrentIndex.projectName) ($($script:CurrentIndex.totalFiles) files)"
        }
        else {
            $displayProject = "未设置"
        }

        Show-MainMenu -CurrentProject $displayProject

        $choice = Read-MenuChoice

        switch ($choice.ToUpper()) {

            "1" {
                Invoke-SetProjectDirectory
            }

            "2" {
                Invoke-PasteAndGenerate
            }

            "3" {
                Invoke-ManualSearchMode
            }

            "4" {
                Invoke-ShowIndex
            }

            "5" {
                Invoke-RebuildIndex
            }

            "Q" {
                Write-Host ""
                Write-Success "  Bye!"
                Write-Host ""
                return
            }

            default {
                Write-Warning2 "  无效选择"
            }
        }
    }
}

# ============================================================
# 启动
# ============================================================

Start-MainLoop