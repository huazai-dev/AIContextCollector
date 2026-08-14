<#
.SYNOPSIS
    目录收集模块
.DESCRIPTION
    支持只提供一个目录（而不是逐个文件），
    自动把该目录下的所有已索引文件生成到同一份 Markdown 文档中。

    核心能力：
      - 从索引中还原出完整的目录树
      - 目录名 / 部分路径 / 绝对路径 / 反斜杠路径 智能匹配
      - 支持递归（含子目录）与仅当前层两种模式
      - 支持从粘贴内容中识别目录路径
#>

# ============================================================
# 从索引还原目录列表
# ============================================================

function Get-IndexDirectories {
    <#
    .SYNOPSIS
        根据索引中的文件相对路径，还原出所有目录（含各级父目录）
    .OUTPUTS
        目录相对路径字符串数组（不含根目录 ""）
    #>
    param(
        [Parameter(Mandatory = $true)]
        [object]$Index
    )

    $dirMap = @{}

    foreach ($f in @($Index.files)) {

        $rp = ConvertTo-NormalizedSearchPath -RawInput $f.relativePath

        $lastSlash = $rp.LastIndexOf('/')
        if ($lastSlash -lt 0) { continue }   # 根目录下的文件

        $dir = $rp.Substring(0, $lastSlash)

        # 逐级向上添加父目录
        while (-not [string]::IsNullOrWhiteSpace($dir)) {

            $key = $dir.ToLower()
            if (-not $dirMap.ContainsKey($key)) {
                $dirMap[$key] = $dir
            }

            $pos = $dir.LastIndexOf('/')
            if ($pos -lt 0) { break }
            $dir = $dir.Substring(0, $pos)
        }
    }

    return @($dirMap.Values | Sort-Object)
}

# ============================================================
# 目录搜索
# ============================================================

function Search-DirectoryInIndex {
    <#
    .SYNOPSIS
        在索引目录树中查找匹配的目录
    .DESCRIPTION
        匹配优先级：
          1 完全匹配
          2 尾部匹配（完整路径段）
          3 包含匹配（完整路径段）
          4 末级目录名匹配
          5 模糊包含
    .OUTPUTS
        @{ Priority = <int>; Matches = <string[]> }
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$SearchTerm,

        [Parameter(Mandatory = $true)]
        [object]$Index
    )

    $term = ConvertTo-NormalizedSearchPath -RawInput $SearchTerm

    if ([string]::IsNullOrWhiteSpace($term)) {
        return @{ Priority = 0; Matches = @() }
    }

    # --- 绝对路径 -> 转成相对项目根的路径 ---
    $projectPath = ConvertTo-NormalizedSearchPath -RawInput $Index.projectPath
    if (-not [string]::IsNullOrWhiteSpace($projectPath)) {
        if ($term.ToLower().StartsWith($projectPath.ToLower())) {
            $term = $term.Substring($projectPath.Length)
            $term = $term.Trim('/')
        }
    }

    # --- 允许带项目名前缀，如 pia/src/main ---
    $projectName = "$($Index.projectName)"
    if (-not [string]::IsNullOrWhiteSpace($projectName)) {
        $prefix = ($projectName.ToLower() + '/')
        if ($term.ToLower().StartsWith($prefix)) {
            $trimmed = $term.Substring($prefix.Length).Trim('/')
            if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
                $term = $trimmed
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($term)) {
        # 指向项目根目录
        return @{ Priority = 1; Matches = @("") }
    }

    $termLower = $term.ToLower()
    $allDirs   = @(Get-IndexDirectories -Index $Index)

    if ($allDirs.Count -eq 0) {
        return @{ Priority = 0; Matches = @() }
    }

    # --- P1: 完全匹配 ---
    $p1 = @($allDirs | Where-Object { $_.ToLower() -eq $termLower })
    if ($p1.Count -gt 0) {
        return @{ Priority = 1; Matches = $p1 }
    }

    # --- P2: 尾部匹配 ---
    $p2 = @($allDirs | Where-Object { $_.ToLower().EndsWith('/' + $termLower) })
    if ($p2.Count -gt 0) {
        return @{ Priority = 2; Matches = $p2 }
    }

    # --- P3: 包含匹配（完整路径段） ---
    $p3 = @($allDirs | Where-Object { $_.ToLower().Contains('/' + $termLower + '/') })
    if ($p3.Count -gt 0) {
        return @{ Priority = 3; Matches = $p3 }
    }

    # --- P4: 末级目录名匹配 ---
    $lastSeg = $termLower
    $segPos  = $termLower.LastIndexOf('/')
    if ($segPos -ge 0) {
        $lastSeg = $termLower.Substring($segPos + 1)
    }

    if (-not [string]::IsNullOrWhiteSpace($lastSeg)) {
        $p4 = @($allDirs | Where-Object {
            $d = $_.ToLower()
            $p = $d.LastIndexOf('/')
            $name = if ($p -ge 0) { $d.Substring($p + 1) } else { $d }
            $name -eq $lastSeg
        })
        if ($p4.Count -gt 0) {
            return @{ Priority = 4; Matches = $p4 }
        }
    }

    # --- P5: 模糊包含 ---
    $p5 = @($allDirs | Where-Object { $_.ToLower().Contains($termLower) })
    if ($p5.Count -gt 0) {
        return @{ Priority = 5; Matches = $p5 }
    }

    return @{ Priority = 0; Matches = @() }
}

# ============================================================
# 获取目录下的文件
# ============================================================

function Get-FilesInDirectory {
    <#
    .SYNOPSIS
        取出索引中位于指定目录下的所有文件
    .PARAMETER DirectoryPath
        相对项目根的目录路径，"" 表示项目根目录
    .PARAMETER Recursive
        是否包含子目录（默认 $true）
    #>
    param(
        [Parameter(Mandatory = $true)]
        [object]$Index,

        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$DirectoryPath,

        [Parameter(Mandatory = $false)]
        [bool]$Recursive = $true
    )

    $dir      = ConvertTo-NormalizedSearchPath -RawInput $DirectoryPath
    $dirLower = $dir.ToLower()

    $result = [System.Collections.ArrayList]::new()

    foreach ($f in @($Index.files)) {

        $rp = ConvertTo-NormalizedSearchPath -RawInput $f.relativePath

        $lastSlash = $rp.LastIndexOf('/')
        if ($lastSlash -lt 0) {
            $fileDir = ""
        }
        else {
            $fileDir = $rp.Substring(0, $lastSlash)
        }

        $fileDirLower = $fileDir.ToLower()

        $isMatch = $false

        if ($fileDirLower -eq $dirLower) {
            $isMatch = $true
        }
        elseif ($Recursive) {
            if ([string]::IsNullOrEmpty($dirLower)) {
                $isMatch = $true
            }
            elseif ($fileDirLower.StartsWith($dirLower + '/')) {
                $isMatch = $true
            }
        }

        if ($isMatch) {
            [void]$result.Add($f)
        }
    }

    return @($result | Sort-Object -Property relativePath)
}

# ============================================================
# 从粘贴内容中提取目录路径
# ============================================================

function Extract-DirectoryPaths {
    <#
    .SYNOPSIS
        从文本中提取「看起来像目录」的路径
    .DESCRIPTION
        规则：
          - 以 / 或 \ 结尾的路径（最典型的目录写法）
          - 含分隔符但末段没有已知文件扩展名的路径
        提取结果仍需通过索引校验，避免误判。
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $dirs = [System.Collections.ArrayList]::new()

    $extList = 'java|xml|vue|js|ts|json|sql|yml|yaml|properties|md|html|css|scss|less|jsx|tsx|py|go|kt|gradle|toml|sh|bat|ps1'

    # 形如 a/b/c、a/b/c/、a\b\c
    $pattern = '(?:[\w\-\.]+[/\\])+[\w\-\.]*'

    $matchResults = [regex]::Matches(
        $Content,
        $pattern,
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )

    foreach ($m in $matchResults) {

        $raw = $m.Value

        $endsWithSep = ($raw.EndsWith('/') -or $raw.EndsWith('\'))

        $normalized = ConvertTo-NormalizedSearchPath -RawInput $raw
        if ([string]::IsNullOrWhiteSpace($normalized)) { continue }

        # 末段带已知扩展名 => 认为是文件，跳过
        if (-not $endsWithSep) {
            $lastSeg = $normalized
            $pos = $normalized.LastIndexOf('/')
            if ($pos -ge 0) {
                $lastSeg = $normalized.Substring($pos + 1)
            }

            $isFile = [regex]::IsMatch(
                $lastSeg,
                ('\.(?:' + $extList + ')$'),
                [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
            )

            if ($isFile) { continue }
            if ([string]::IsNullOrWhiteSpace($lastSeg)) { continue }
        }

        if ($normalized -notin $dirs) {
            [void]$dirs.Add($normalized)
        }
    }

    return $dirs.ToArray()
}

function Resolve-DirectoryCandidates {
    <#
    .SYNOPSIS
        把提取到的目录候选，通过索引校验成真实存在的目录
    .DESCRIPTION
        只接受高置信度匹配（完全匹配 / 尾部匹配），避免误判
    .OUTPUTS
        目录相对路径字符串数组
    #>
    param(
        [Parameter(Mandatory = $true)]
        [array]$Candidates,

        [Parameter(Mandatory = $true)]
        [object]$Index,

        [Parameter(Mandatory = $false)]
        [int]$MaxPriority = 2
    )

    $resolved = [System.Collections.ArrayList]::new()

    foreach ($c in $Candidates) {

        $r = Search-DirectoryInIndex -SearchTerm $c -Index $Index

        if ($r.Priority -le 0 -or $r.Priority -gt $MaxPriority) { continue }
        if ($r.Matches.Count -ne 1) { continue }

        $dir = $r.Matches[0]
        if ([string]::IsNullOrWhiteSpace($dir)) { continue }

        if ($dir -notin $resolved) {
            [void]$resolved.Add($dir)
        }
    }

    return $resolved.ToArray()
}

# ============================================================
# 文件列表合并去重
# ============================================================

function Merge-FileLists {
    <#
    .SYNOPSIS
        合并「目录收录」与「文件名搜索」两份结果，按 fullPath 去重（保持先后顺序）
    .NOTES
        这里刻意使用两个独立参数而不是「数组的数组」，
        因为 PowerShell 会把 @($a, $b) 这种嵌套数组自动展平。
    #>
    param(
        [Parameter(Mandatory = $false)]
        [AllowEmptyCollection()]
        [array]$DirectoryFiles = @(),

        [Parameter(Mandatory = $false)]
        [AllowEmptyCollection()]
        [array]$SearchedFiles = @()
    )

    $merged = [System.Collections.ArrayList]::new()
    $seen   = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )

    foreach ($f in (@($DirectoryFiles) + @($SearchedFiles))) {

        if ($null -eq $f) { continue }

        $key = "$($f.fullPath)"
        if ([string]::IsNullOrWhiteSpace($key)) { $key = "$($f.relativePath)" }

        if (-not $seen.Contains($key)) {
            [void]$seen.Add($key)
            [void]$merged.Add($f)
        }
    }

    return $merged.ToArray()
}

# ============================================================
# 目录内容概览
# ============================================================

function Show-DirectoryPreview {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$DirectoryPath,

        [Parameter(Mandatory = $true)]
        [array]$Files,

        [Parameter(Mandatory = $false)]
        [int]$MaxDisplay = 30
    )

    $displayDir = if ([string]::IsNullOrWhiteSpace($DirectoryPath)) { "<项目根目录>" } else { $DirectoryPath }

    $totalSize = 0
    foreach ($f in $Files) { $totalSize += $f.fileSize }

    Write-Host ""
    Write-ThinSeparator
    Write-ColorText -Text "  目录: " -Color "White" -NoNewline
    Write-ColorText -Text $displayDir -Color "Yellow"
    Write-Info "  文件数量: $($Files.Count)"
    Write-Info "  总大小  : $(Format-FileSize -SizeInBytes $totalSize)"
    Write-ThinSeparator
    Write-Host ""

    $displayCount = [math]::Min($Files.Count, $MaxDisplay)

    for ($i = 0; $i -lt $displayCount; $i++) {
        $f = $Files[$i]
        Write-ColorText -Text "    [$($i + 1)] " -Color "Cyan" -NoNewline
        Write-Info "$($f.relativePath)  ($(Format-FileSize -SizeInBytes $f.fileSize))"
    }

    if ($Files.Count -gt $displayCount) {
        Write-ColorText -Text "    ... 还有 $($Files.Count - $displayCount) 个文件" -Color "DarkGray"
    }

    Write-Host ""
}

# ============================================================
# 功能入口：按目录生成上下文
# ============================================================

function Invoke-DirectoryCollect {
    <#
    .SYNOPSIS
        交互式：输入一个目录，把该目录下的所有文件生成到一份 Markdown 中
    #>
    param(
        [Parameter(Mandatory = $true)]
        [object]$Index,

        [Parameter(Mandatory = $true)]
        [string]$OutputPath,

        [Parameter(Mandatory = $true)]
        [string]$OutputFileName
    )

    Write-Host ""
    Write-Title "  按目录生成上下文"
    Write-Info  "  输入一个目录即可，工具会把该目录下的所有文件合并成一份文档"
    Write-Host ""
    Write-Info  "  支持写法:"
    Write-ColorText -Text "    src/main/java/com/demo/service" -Color "DarkGray"
    Write-ColorText -Text "    src\main\java\com\demo\service  (反斜杠)" -Color "DarkGray"
    Write-ColorText -Text "    service                          (只写目录名)" -Color "DarkGray"
    Write-ColorText -Text "    D:\workspace\pia\src\service     (绝对路径)" -Color "DarkGray"
    Write-Host ""
    Write-ColorText -Text "    输入 " -Color "DarkGray" -NoNewline
    Write-ColorText -Text "list" -Color "Cyan" -NoNewline
    Write-ColorText -Text " 查看目录树, 输入 " -Color "DarkGray" -NoNewline
    Write-ColorText -Text "q" -Color "Cyan" -NoNewline
    Write-ColorText -Text " 返回主菜单" -Color "DarkGray"
    Write-Host ""

    $targetDir = $null

    while ($true) {

        $rawInput = Read-UserInput -Prompt "  请输入目录 > "

        if (Test-IsNullOrWhiteSpace -Value $rawInput) {
            Write-Warning2 "  未输入内容"
            continue
        }

        $cmd = $rawInput.Trim().ToLower()

        if ($cmd -eq 'q') {
            Write-Info "  已退出"
            return
        }

        if ($cmd -eq 'list') {
            Show-DirectoryTree -Index $Index
            continue
        }

        $searchResult = Search-DirectoryInIndex -SearchTerm $rawInput -Index $Index
        $dirMatches   = @($searchResult.Matches)

        if ($dirMatches.Count -eq 0) {
            Write-Error2 "  未找到匹配的目录: $rawInput"
            Write-Info   "  可输入 list 查看可用目录"
            Write-Host ""
            continue
        }

        if ($dirMatches.Count -eq 1) {
            $targetDir = $dirMatches[0]
            break
        }

        # 多个匹配 -> 让用户选择
        Write-Host ""
        Write-Warning2 "  找到 $($dirMatches.Count) 个匹配目录:"
        Write-Host ""

        $displayCount = [math]::Min($dirMatches.Count, 20)

        for ($i = 0; $i -lt $displayCount; $i++) {
            $d = $dirMatches[$i]
            $cnt = @(Get-FilesInDirectory -Index $Index -DirectoryPath $d -Recursive $true).Count
            Write-ColorText -Text "    [$($i + 1)] " -Color "Cyan" -NoNewline
            Write-Info "$d  ($cnt 个文件)"
        }

        if ($dirMatches.Count -gt $displayCount) {
            Write-ColorText -Text "    ... 还有 $($dirMatches.Count - $displayCount) 个, 请输入更完整的路径" -Color "DarkGray"
        }

        Write-ColorText -Text "    [0] " -Color "Red" -NoNewline
        Write-Info "重新输入"
        Write-Host ""
        Write-ColorText -Text "  请选择 > " -Color "Green" -NoNewline

        $choice = Read-Host
        $idx = 0

        if ([int]::TryParse($choice.Trim(), [ref]$idx)) {
            if ($idx -ge 1 -and $idx -le $displayCount) {
                $targetDir = $dirMatches[$idx - 1]
                break
            }
        }

        Write-Host ""
        continue
    }

    if ($null -eq $targetDir) { return }

    # ---- 是否递归 ----
    Write-Host ""
    $recursive = Read-Confirmation -Message "是否包含子目录下的文件?" -DefaultYes $true

    $files = @(Get-FilesInDirectory -Index $Index -DirectoryPath $targetDir -Recursive $recursive)

    if ($files.Count -eq 0) {
        Write-Warning2 "  该目录下没有已索引的文件"
        if (-not $recursive) {
            Write-Info "  提示: 可以尝试选择「包含子目录」"
        }
        return
    }

    Show-DirectoryPreview -DirectoryPath $targetDir -Files $files

    # ---- 文件较多时二次提醒 ----
    if ($files.Count -gt 50) {
        Write-Warning2 "  注意: 文件数量较多 ($($files.Count) 个), 生成的内容可能超出 AI 的上下文长度"
    }

    $confirmed = Read-Confirmation `
        -Message "确认生成这 $($files.Count) 个文件的 Markdown?" `
        -DefaultYes $true

    if (-not $confirmed) {
        Write-Info "  已取消"
        return
    }

    # ---- 生成 ----
    Write-Host ""
    Write-Title "  生成 Markdown..."

    $displayDir = if ([string]::IsNullOrWhiteSpace($targetDir)) { "<项目根目录>" } else { $targetDir }
    $scopeText  = if ($recursive) { "含子目录" } else { "仅当前目录" }

    $mdContent = Build-MarkdownContent `
        -Files       $files `
        -ProjectName $Index.projectName `
        -SourceLabel "目录 $displayDir ($scopeText)"

    $outFile = Save-MarkdownOutput `
        -Content   $mdContent `
        -OutputDir $OutputPath `
        -FileName  $OutputFileName

    Copy-ToClipboard -Text $mdContent

    $totalSize = 0
    foreach ($f in $files) { $totalSize += $f.fileSize }

    Write-Host ""
    Write-Separator -Char "=" -Length 60 -Color "Green"
    Write-Success "  生成完成!"
    Write-Info    "  来源目录: $displayDir ($scopeText)"
    Write-Info    "  文件数量: $($files.Count)"
    Write-Info    "  总大小  : $(Format-FileSize -SizeInBytes $totalSize)"
    Write-Info    "  字符数  : $($mdContent.Length)"
    Write-Info    "  输出文件: $outFile"
    Write-Success "  已复制到剪贴板!"
    Write-Separator -Char "=" -Length 60 -Color "Green"
    Write-Host ""
}

# ============================================================
# 目录树展示
# ============================================================

function Show-DirectoryTree {
    <#
    .SYNOPSIS
        展示索引中的目录及其文件数量
    #>
    param(
        [Parameter(Mandatory = $true)]
        [object]$Index,

        [Parameter(Mandatory = $false)]
        [int]$MaxDisplay = 60
    )

    $dirs = @(Get-IndexDirectories -Index $Index)

    Write-Host ""
    Write-Title "  项目目录 (共 $($dirs.Count) 个):"
    Write-Host ""

    if ($dirs.Count -eq 0) {
        Write-Warning2 "  索引中没有目录信息"
        Write-Host ""
        return
    }

    $displayCount = [math]::Min($dirs.Count, $MaxDisplay)

    for ($i = 0; $i -lt $displayCount; $i++) {

        $d = $dirs[$i]
        $depth = ($d.Split('/')).Count - 1
        $indent = "  " * $depth
        $name = $d
        $pos = $d.LastIndexOf('/')
        if ($pos -ge 0) { $name = $d.Substring($pos + 1) }

        $directCount = @(Get-FilesInDirectory -Index $Index -DirectoryPath $d -Recursive $false).Count

        Write-ColorText -Text "    $indent" -Color "DarkGray" -NoNewline
        Write-ColorText -Text "$name/ " -Color "Cyan" -NoNewline

        if ($directCount -gt 0) {
            Write-ColorText -Text "($directCount)" -Color "DarkGray"
        }
        else {
            Write-Host ""
        }
    }

    if ($dirs.Count -gt $displayCount) {
        Write-ColorText -Text "    ... 还有 $($dirs.Count - $displayCount) 个目录" -Color "DarkGray"
    }

    Write-Host ""
}
