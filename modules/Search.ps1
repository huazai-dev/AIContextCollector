<#
.SYNOPSIS
    文件搜索模块
.DESCRIPTION
    核心特性：
      - 智能提取：一行多文件、空格/逗号分隔、混合中文描述
      - 路径感知搜索、反斜杠兼容
      - 自动裁剪多余路径前缀
      - 多行粘贴支持
#>

# ============================================================
# 路径规范化
# ============================================================

function ConvertTo-NormalizedSearchPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RawInput
    )

    if ([string]::IsNullOrWhiteSpace($RawInput)) { return "" }

    $result = $RawInput.Trim()
    $result = $result.Trim('"', "'")
    $result = $result.Trim('`')
    $result = $result.Replace('\', '/')

    while ($result.StartsWith('./')) {
        $result = $result.Substring(2)
    }

    $result = $result.Trim('/')
    $result = $result.Trim()

    return $result
}

# ============================================================
# 从 GPT 内容中提取文件名/路径
# ============================================================

function Extract-FileNames {
    <#
    .SYNOPSIS
        从文本中智能提取所有文件名/路径
    .DESCRIPTION
        支持：
          - 一行一个文件
          - 一行多个文件（空格/逗号/分号/顿号分隔）
          - 混在中文描述中
          - 带编号/符号前缀
          - 正斜杠和反斜杠路径
          - 反引号包裹
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $fileNames = [System.Collections.ArrayList]::new()

    $extList = 'java|xml|vue|js|ts|json|sql|yml|yaml|properties|md|html|css|scss|less|jsx|tsx|py|go|kt|gradle|toml|sh|bat|ps1'

    # 核心正则：[可选路径]文件名.扩展名
    $pattern = '(?:[\w\-\.]+[/\\])*[\w\-\.]+\.(?:' + $extList + ')'

    # === 第一轮：对每一行做全局正则匹配 ===
    $lines = $Content -split "`n"

    foreach ($line in $lines) {

        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }

        # 一行中可能有多个文件名，全局匹配
        $matchResults = [regex]::Matches(
            $trimmed,
            $pattern,
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        )

        foreach ($m in $matchResults) {
            $normalized = ConvertTo-NormalizedSearchPath -RawInput $m.Value
            if (-not [string]::IsNullOrWhiteSpace($normalized)) {
                if ($normalized -notin $fileNames) {
                    [void]$fileNames.Add($normalized)
                }
            }
        }
    }

    # === 第二轮兜底：如果第一轮没结果，按分隔符拆分整个内容再匹配 ===
    if ($fileNames.Count -eq 0) {

        $tokens = $Content -split '[\s,;，；、\n\r\t]+'

        foreach ($token in $tokens) {

            $cleaned = $token.Trim('`', '"', "'", '(', ')', '[', ']', '{', '}')
            $cleaned = $cleaned.Trim()
            if ([string]::IsNullOrWhiteSpace($cleaned)) { continue }

            $tokenMatch = [regex]::Match(
                $cleaned,
                ('^' + $pattern + '$'),
                [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
            )

            if ($tokenMatch.Success) {
                $normalized = ConvertTo-NormalizedSearchPath -RawInput $tokenMatch.Value
                if (-not [string]::IsNullOrWhiteSpace($normalized)) {
                    if ($normalized -notin $fileNames) {
                        [void]$fileNames.Add($normalized)
                    }
                }
            }
        }
    }

    return $fileNames.ToArray()
}

# ============================================================
# 搜索路径子变体生成
# ============================================================

function Get-SearchPathVariants {
    param(
        [Parameter(Mandatory = $true)]
        [string]$NormalizedPath
    )

    $variants = [System.Collections.ArrayList]::new()
    [void]$variants.Add($NormalizedPath)

    $remaining = $NormalizedPath
    while ($remaining.Contains('/')) {
        $slashPos = $remaining.IndexOf('/')
        $remaining = $remaining.Substring($slashPos + 1)
        if (-not [string]::IsNullOrWhiteSpace($remaining)) {
            [void]$variants.Add($remaining)
        }
    }

    return $variants.ToArray()
}

# ============================================================
# 核心搜索
# ============================================================

function Search-FileInIndex {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SearchTerm,

        [Parameter(Mandatory = $true)]
        [object]$Index
    )

    $hasPath = ($SearchTerm -match '[/\\]')

    $search = ConvertTo-NormalizedSearchPath -RawInput $SearchTerm
    $searchLower = $search.ToLower()

    if ([string]::IsNullOrWhiteSpace($search)) {
        return @{ Priority = 0; Matches = @() }
    }

    $fileList = @($Index.files)
    if ($fileList.Count -eq 0) {
        return @{ Priority = 0; Matches = @() }
    }

    # ================================================================
    # 带路径搜索
    # ================================================================
    if ($hasPath) {

        $variants = Get-SearchPathVariants -NormalizedPath $searchLower

        # --- P1: 完全等于任一变体 ---
        $p1 = [System.Collections.ArrayList]::new()
        foreach ($f in $fileList) {
            $rp = (ConvertTo-NormalizedSearchPath -RawInput $f.relativePath).ToLower()
            foreach ($v in $variants) {
                if ($rp -eq $v) {
                    [void]$p1.Add($f)
                    break
                }
            }
        }
        if ($p1.Count -gt 0) {
            return @{ Priority = 1; Matches = $p1.ToArray() }
        }

        # --- P2: 以任一变体结尾（完整路径段） ---
        $p2 = [System.Collections.ArrayList]::new()
        foreach ($f in $fileList) {
            $rp = (ConvertTo-NormalizedSearchPath -RawInput $f.relativePath).ToLower()
            foreach ($v in $variants) {
                if (-not $v.Contains('/')) { continue }
                if ($rp -eq $v -or $rp.EndsWith('/' + $v)) {
                    [void]$p2.Add($f)
                    break
                }
            }
        }
        if ($p2.Count -gt 0) {
            return @{ Priority = 2; Matches = $p2.ToArray() }
        }

        # --- P3: 包含任一变体 ---
        $p3 = [System.Collections.ArrayList]::new()
        foreach ($f in $fileList) {
            $rp = (ConvertTo-NormalizedSearchPath -RawInput $f.relativePath).ToLower()
            foreach ($v in $variants) {
                if (-not $v.Contains('/')) { continue }
                if ($rp.Contains($v)) {
                    [void]$p3.Add($f)
                    break
                }
            }
        }
        if ($p3.Count -gt 0) {
            return @{ Priority = 3; Matches = $p3.ToArray() }
        }

        # --- P4: 路径段顺序匹配 ---
        $searchParts = $searchLower.Split('/')
        $p4 = [System.Collections.ArrayList]::new()

        foreach ($f in $fileList) {
            $rp = (ConvertTo-NormalizedSearchPath -RawInput $f.relativePath).ToLower()
            $allMatch = $true
            $lastPos = 0

            foreach ($part in $searchParts) {
                if ([string]::IsNullOrWhiteSpace($part)) { continue }
                $pos = $rp.IndexOf($part, $lastPos)
                if ($pos -lt 0) {
                    $allMatch = $false
                    break
                }
                $lastPos = $pos + $part.Length
            }

            if ($allMatch) {
                [void]$p4.Add($f)
            }
        }
        if ($p4.Count -gt 0) {
            return @{ Priority = 4; Matches = $p4.ToArray() }
        }

        # --- P5: 纯文件名兜底 ---
        $searchFileName = $search
        $lastSlash = $search.LastIndexOf('/')
        if ($lastSlash -ge 0) {
            $searchFileName = $search.Substring($lastSlash + 1)
        }
        $sfnLower = $searchFileName.ToLower()

        $p5 = [System.Collections.ArrayList]::new()
        foreach ($f in $fileList) {
            if ($f.fileName.ToLower() -eq $sfnLower) {
                [void]$p5.Add($f)
            }
        }
        if ($p5.Count -gt 0) {
            return @{ Priority = 5; Matches = $p5.ToArray() }
        }

        return @{ Priority = 0; Matches = @() }
    }

    # ================================================================
    # 纯文件名搜索
    # ================================================================
    else {

        $nameMatches = [System.Collections.ArrayList]::new()
        foreach ($f in $fileList) {
            if ($f.fileName.ToLower() -eq $searchLower) {
                [void]$nameMatches.Add($f)
            }
        }

        if ($nameMatches.Count -gt 0) {
            return @{ Priority = 3; Matches = $nameMatches.ToArray() }
        }

        return @{ Priority = 0; Matches = @() }
    }
}

# ============================================================
# 批量搜索并解决冲突
# ============================================================

function Search-FilesWithResolution {
    param(
        [Parameter(Mandatory = $true)]
        [array]$FileNames,

        [Parameter(Mandatory = $true)]
        [object]$Index
    )

    $resolvedFiles = [System.Collections.ArrayList]::new()
    $notFoundFiles = [System.Collections.ArrayList]::new()

    $addedPaths = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )

    Write-Host ""
    Write-Title "  搜索文件..."
    Write-Host ""

    foreach ($fileName in $FileNames) {

        $searchResult = Search-FileInIndex -SearchTerm $fileName -Index $Index
        $matchCount = $searchResult.Matches.Count

        if ($matchCount -eq 0) {
            Write-ColorText -Text "  X " -Color "Red" -NoNewline
            Write-Info "$fileName  ->  未找到"
            [void]$notFoundFiles.Add($fileName)
        }
        elseif ($matchCount -eq 1) {
            $matched = $searchResult.Matches[0]
            if ($addedPaths.Contains($matched.fullPath)) {
                Write-ColorText -Text "  = " -Color "DarkGray" -NoNewline
                Write-Info "$($matched.relativePath)  (重复, 跳过)"
            }
            else {
                [void]$addedPaths.Add($matched.fullPath)
                [void]$resolvedFiles.Add($matched)
                $label = Get-PriorityLabel -Priority $searchResult.Priority
                Write-ColorText -Text "  + " -Color "Green" -NoNewline
                Write-Info "$($matched.relativePath)  [$label]"
            }
        }
        else {
            $selected = Show-CandidateSelection `
                -FileName   $fileName `
                -Candidates $searchResult.Matches

            foreach ($sel in $selected) {
                if (-not $addedPaths.Contains($sel.fullPath)) {
                    [void]$addedPaths.Add($sel.fullPath)
                    [void]$resolvedFiles.Add($sel)
                    Write-ColorText -Text "  + " -Color "Green" -NoNewline
                    Write-Info "$($sel.relativePath)  (已选择)"
                }
            }
        }
    }

    Write-Host ""
    Write-ThinSeparator
    Write-Info "  找到: $($resolvedFiles.Count) 个文件"

    if ($notFoundFiles.Count -gt 0) {
        Write-Warning2 "  未找到: $($notFoundFiles.Count) 个文件"
        foreach ($nf in $notFoundFiles) {
            Write-ColorText -Text "    - $nf" -Color "DarkYellow"
        }
    }

    return $resolvedFiles.ToArray()
}

# ============================================================
# 优先级标签
# ============================================================

function Get-PriorityLabel {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Priority
    )

    switch ($Priority) {
        1 { return "完全匹配" }
        2 { return "尾部匹配" }
        3 { return "包含匹配" }
        4 { return "段顺序匹配" }
        5 { return "文件名兜底" }
        default { return "匹配" }
    }
}

# ============================================================
# 手动搜索
# ============================================================

function Invoke-ManualSearch {
    <#
    .SYNOPSIS
        交互式搜索
        支持一行输入多个文件（空格/逗号分隔）
        搜索到的文件收集起来，最后统一生成 Markdown 并复制到剪贴板
    #>
    param(
        [Parameter(Mandatory = $true)]
        [object]$Index
    )

    Write-Host ""
    Write-Title "  手动搜索文件"
    Write-Info  "  支持一行输入多个文件 (空格或逗号分隔)"
    Write-Info  "  支持正斜杠和反斜杠路径"
    Write-Host ""
    Write-Info  "  命令:"
    Write-ColorText -Text "    q       " -Color "Cyan" -NoNewline
    Write-Info "退出 (不生成)"
    Write-ColorText -Text "    done    " -Color "Cyan" -NoNewline
    Write-Info "结束搜索, 生成 Markdown"
    Write-ColorText -Text "    list    " -Color "Cyan" -NoNewline
    Write-Info "查看已收集的文件"
    Write-ColorText -Text "    clear   " -Color "Cyan" -NoNewline
    Write-Info "清空已收集的文件"
    Write-Host ""

    # 收集已选中的文件
    $collectedFiles = [System.Collections.ArrayList]::new()
    $addedPaths = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )

    while ($true) {

        Write-ColorText -Text "  搜索 ($($collectedFiles.Count) 个已收集) > " -Color "Green" -NoNewline
        $rawInput = Read-Host

        if ([string]::IsNullOrWhiteSpace($rawInput)) {
            continue
        }

        $cmd = $rawInput.Trim().ToLower()

        # ---- 退出 ----
        if ($cmd -eq 'q') {
            Write-Info "  已退出手动搜索"
            return
        }

        # ---- 查看已收集 ----
        if ($cmd -eq 'list') {
            if ($collectedFiles.Count -eq 0) {
                Write-Warning2 "  还没有收集任何文件"
            }
            else {
                Write-Host ""
                Write-Title "  已收集 $($collectedFiles.Count) 个文件:"
                for ($i = 0; $i -lt $collectedFiles.Count; $i++) {
                    Write-ColorText -Text "    [$($i + 1)] " -Color "Cyan" -NoNewline
                    Write-Info $collectedFiles[$i].relativePath
                }
            }
            Write-Host ""
            continue
        }

        # ---- 清空 ----
        if ($cmd -eq 'clear') {
            $collectedFiles.Clear()
            $addedPaths.Clear()
            Write-Success "  已清空收集列表"
            Write-Host ""
            continue
        }

        # ---- 完成，生成 Markdown ----
        if ($cmd -eq 'done') {

            if ($collectedFiles.Count -eq 0) {
                Write-Warning2 "  还没有收集任何文件，请先搜索并添加"
                Write-Host ""
                continue
            }

            # 直接跳出循环，后面生成
            break
        }

        # ---- 正常搜索 ----
        $extracted = Extract-FileNames -Content $rawInput

        if ($extracted.Count -eq 0) {
            $extracted = @($rawInput.Trim())
        }

        foreach ($keyword in $extracted) {

            Write-Host ""
            Write-ColorText -Text "  >> " -Color "Cyan" -NoNewline
            Write-ColorText -Text "搜索: " -Color "White" -NoNewline
            Write-ColorText -Text $keyword -Color "Yellow"

            $searchResult = Search-FileInIndex -SearchTerm $keyword -Index $Index

            if ($searchResult.Matches.Count -eq 0) {

                # 模糊兜底
                $normalizedKw = ConvertTo-NormalizedSearchPath -RawInput $keyword
                $kwLower = $normalizedKw.ToLower()

                $fuzzyMatches = @($Index.files | Where-Object {
                    $rpLower = (ConvertTo-NormalizedSearchPath -RawInput $_.relativePath).ToLower()
                    $rpLower -like "*$kwLower*" -or $_.fileName.ToLower() -like "*$kwLower*"
                })

                if ($fuzzyMatches.Count -gt 0) {
                    Write-Warning2 "     未精确匹配, 模糊结果 ($($fuzzyMatches.Count) 个):"

                    $displayCount = [math]::Min($fuzzyMatches.Count, 10)
                    for ($i = 0; $i -lt $displayCount; $i++) {
                        Write-ColorText -Text "     [$($i + 1)] " -Color "Cyan" -NoNewline
                        Write-Info $fuzzyMatches[$i].relativePath
                    }

                    # 让用户选择模糊结果
                    Write-ColorText -Text "     [0] " -Color "Red" -NoNewline
                    Write-Info "跳过"
                    Write-ColorText -Text "     [A] " -Color "Magenta" -NoNewline
                    Write-Info "全部添加"
                    Write-Host ""
                    Write-ColorText -Text "     选择 > " -Color "Green" -NoNewline
                    $fuzzyChoice = Read-Host

                    if ($fuzzyChoice.Trim().ToUpper() -eq 'A') {
                        foreach ($fm in $fuzzyMatches) {
                            if (-not $addedPaths.Contains($fm.fullPath)) {
                                [void]$addedPaths.Add($fm.fullPath)
                                [void]$collectedFiles.Add($fm)
                                Write-ColorText -Text "     + " -Color "Green" -NoNewline
                                Write-Info "$($fm.relativePath)"
                            }
                        }
                    }
                    elseif ($fuzzyChoice.Trim() -ne '0') {
                        $parts = $fuzzyChoice.Trim().Split(',')
                        foreach ($part in $parts) {
                            $idx = 0
                            if ([int]::TryParse($part.Trim(), [ref]$idx)) {
                                if ($idx -ge 1 -and $idx -le $fuzzyMatches.Count) {
                                    $sel = $fuzzyMatches[$idx - 1]
                                    if (-not $addedPaths.Contains($sel.fullPath)) {
                                        [void]$addedPaths.Add($sel.fullPath)
                                        [void]$collectedFiles.Add($sel)
                                        Write-ColorText -Text "     + " -Color "Green" -NoNewline
                                        Write-Info "$($sel.relativePath)"
                                    }
                                }
                            }
                        }
                    }
                }
                else {
                    Write-Error2 "     未找到: $keyword"
                }
            }
            elseif ($searchResult.Matches.Count -eq 1) {

                # 唯一匹配，自动添加
                $matched = $searchResult.Matches[0]
                $label = Get-PriorityLabel -Priority $searchResult.Priority

                if ($addedPaths.Contains($matched.fullPath)) {
                    Write-ColorText -Text "     = " -Color "DarkGray" -NoNewline
                    Write-Info "$($matched.relativePath)  (已收集, 跳过)"
                }
                else {
                    [void]$addedPaths.Add($matched.fullPath)
                    [void]$collectedFiles.Add($matched)
                    Write-ColorText -Text "     + " -Color "Green" -NoNewline
                    Write-Info "$($matched.relativePath)  [$label] (已添加)"
                }
            }
            else {

                # 多个匹配，让用户选择
                $label = Get-PriorityLabel -Priority $searchResult.Priority
                Write-Warning2 "     找到 $($searchResult.Matches.Count) 个匹配 ($label):"
                Write-Host ""

                for ($i = 0; $i -lt $searchResult.Matches.Count; $i++) {
                    $m = $searchResult.Matches[$i]
                    $size = Format-FileSize -SizeInBytes $m.fileSize
                    Write-ColorText -Text "     [$($i + 1)] " -Color "Cyan" -NoNewline
                    Write-Info "$($m.relativePath)  ($size)"
                }

                Write-ColorText -Text "     [0] " -Color "Red" -NoNewline
                Write-Info "跳过"
                Write-ColorText -Text "     [A] " -Color "Magenta" -NoNewline
                Write-Info "全部添加"
                Write-Host ""
                Write-ColorText -Text "     选择 (可逗号分隔) > " -Color "Green" -NoNewline
                $userChoice = Read-Host

                if ($userChoice.Trim().ToUpper() -eq 'A') {
                    foreach ($m in $searchResult.Matches) {
                        if (-not $addedPaths.Contains($m.fullPath)) {
                            [void]$addedPaths.Add($m.fullPath)
                            [void]$collectedFiles.Add($m)
                            Write-ColorText -Text "     + " -Color "Green" -NoNewline
                            Write-Info "$($m.relativePath)"
                        }
                    }
                }
                elseif ($userChoice.Trim() -ne '0') {
                    $parts = $userChoice.Trim().Split(',')
                    foreach ($part in $parts) {
                        $idx = 0
                        if ([int]::TryParse($part.Trim(), [ref]$idx)) {
                            if ($idx -ge 1 -and $idx -le $searchResult.Matches.Count) {
                                $sel = $searchResult.Matches[$idx - 1]
                                if (-not $addedPaths.Contains($sel.fullPath)) {
                                    [void]$addedPaths.Add($sel.fullPath)
                                    [void]$collectedFiles.Add($sel)
                                    Write-ColorText -Text "     + " -Color "Green" -NoNewline
                                    Write-Info "$($sel.relativePath)"
                                }
                            }
                        }
                    }
                }
            }
        }

        Write-Host ""
    }

    # ================================================================
    # 生成 Markdown
    # ================================================================

    Write-Host ""
    Write-Title "  已收集 $($collectedFiles.Count) 个文件:"
    Write-Host ""

    for ($i = 0; $i -lt $collectedFiles.Count; $i++) {
        $f = $collectedFiles[$i]
        $size = Format-FileSize -SizeInBytes $f.fileSize
        Write-ColorText -Text "    [$($i + 1)] " -Color "Cyan" -NoNewline
        Write-Info "$($f.relativePath)  ($size)"
    }

    Write-Host ""
    $confirmed = Read-Confirmation `
        -Message "确认生成这 $($collectedFiles.Count) 个文件的 Markdown?" `
        -DefaultYes $true

    if (-not $confirmed) {
        Write-Info "  已取消"
        return
    }

    Write-Host ""
    Write-Title "  生成 Markdown..."

    $mdContent = Build-MarkdownContent `
        -Files       $collectedFiles.ToArray() `
        -ProjectName $Index.projectName

    # 保存
    $outFile = Save-MarkdownOutput `
        -Content   $mdContent `
        -OutputDir $script:OutputPath `
        -FileName  $script:Config.output.defaultFileName

    # 复制到剪贴板
    Copy-ToClipboard -Text $mdContent

    # 完成
    $totalSize = 0
    foreach ($f in $collectedFiles) { $totalSize += $f.fileSize }

    Write-Host ""
    Write-Separator -Char "=" -Length 60 -Color "Green"
    Write-Success "  生成完成!"
    Write-Info    "  文件数量: $($collectedFiles.Count)"
    Write-Info    "  总大小  : $(Format-FileSize -SizeInBytes $totalSize)"
    Write-Info    "  字符数  : $($mdContent.Length)"
    Write-Info    "  输出文件: $outFile"
    Write-Success "  已复制到剪贴板!"
    Write-Separator -Char "=" -Length 60 -Color "Green"
    Write-Host ""
}