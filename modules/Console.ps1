<#
.SYNOPSIS
    控制台UI模块
#>

# ============================================================
# 基础颜色输出
# ============================================================

function Write-ColorText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text,

        [Parameter(Mandatory = $false)]
        [string]$Color = "White",

        [Parameter(Mandatory = $false)]
        [switch]$NoNewline
    )

    $params = @{
        Object          = $Text
        ForegroundColor = $Color
    }

    if ($NoNewline) {
        $params["NoNewline"] = $true
    }

    Write-Host @params
}

function Write-Title {
    param([string]$Text)
    Write-ColorText -Text $Text -Color "Cyan"
}

function Write-Success {
    param([string]$Text)
    Write-ColorText -Text $Text -Color "Green"
}

function Write-Warning2 {
    param([string]$Text)
    Write-ColorText -Text $Text -Color "Yellow"
}

function Write-Error2 {
    param([string]$Text)
    Write-ColorText -Text $Text -Color "Red"
}

function Write-Info {
    param([string]$Text)
    Write-ColorText -Text $Text -Color "White"
}

function Write-Highlight {
    param([string]$Text)
    Write-ColorText -Text $Text -Color "Magenta"
}

# ============================================================
# 分隔线
# ============================================================

function Write-Separator {
    param(
        [Parameter(Mandatory = $false)]
        [string]$Char = "=",

        [Parameter(Mandatory = $false)]
        [int]$Length = 60,

        [Parameter(Mandatory = $false)]
        [string]$Color = "DarkGray"
    )

    Write-ColorText -Text ($Char * $Length) -Color $Color
}

function Write-ThinSeparator {
    Write-Separator -Char "-" -Length 60 -Color "DarkGray"
}

# ============================================================
# Banner
# ============================================================

function Show-Banner {
    Write-Host ""
    Write-ColorText -Text "  ============================================" -Color "Cyan"
    Write-ColorText -Text "       AI Context Collector  v1.0.0          " -Color "Cyan"
    Write-ColorText -Text "  ============================================" -Color "Cyan"
    Write-Host ""
}

# ============================================================
# 主菜单
# ============================================================

function Show-MainMenu {
    param(
        [Parameter(Mandatory = $false)]
        [string]$CurrentProject = "未设置"
    )

    Write-Host ""
    Write-Separator
    Write-ColorText -Text "  当前项目: " -Color "White" -NoNewline
    Write-ColorText -Text $CurrentProject -Color "Yellow"
    Write-Separator
    Write-Host ""
    Write-ColorText -Text "  [1] " -Color "Cyan" -NoNewline
    Write-Info "设置项目目录 (建立索引)"
    Write-ColorText -Text "  [2] " -Color "Cyan" -NoNewline
    Write-Info "粘贴 GPT 内容并生成上下文"
    Write-ColorText -Text "  [3] " -Color "Cyan" -NoNewline
    Write-Info "按目录生成上下文 (整个目录合并成一份文档)"
    Write-ColorText -Text "  [4] " -Color "Cyan" -NoNewline
    Write-Info "手动搜索文件"
    Write-ColorText -Text "  [5] " -Color "Cyan" -NoNewline
    Write-Info "查看当前索引信息"
    Write-ColorText -Text "  [6] " -Color "Cyan" -NoNewline
    Write-Info "重建索引"
    Write-ColorText -Text "  [Q] " -Color "Red" -NoNewline
    Write-Info "退出"
    Write-Host ""
    Write-ThinSeparator
}

# ============================================================
# 用户输入
# ============================================================

function Read-UserInput {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Prompt,

        [Parameter(Mandatory = $false)]
        [string]$DefaultValue = ""
    )

    Write-ColorText -Text $Prompt -Color "Yellow" -NoNewline
    $userText = Read-Host

    if ([string]::IsNullOrWhiteSpace($userText) -and `
        -not [string]::IsNullOrWhiteSpace($DefaultValue)) {
        return $DefaultValue
    }

    return $userText
}

function Read-MenuChoice {
    Write-ColorText -Text "  请选择操作 > " -Color "Green" -NoNewline
    $choice = Read-Host
    return $choice.Trim()
}

# ============================================================
# 多行输入（连续三次回车结束）
# ============================================================

function Read-MultiLineInput {
    <#
    .SYNOPSIS
        读取多行输入
        连续两个空行结束（即连续按三次回车）
    #>
    param(
        [Parameter(Mandatory = $false)]
        [string]$Prompt = "请粘贴内容 (连续三次回车结束):"
    )

    Write-ColorText -Text $Prompt -Color "Yellow"
    Write-ColorText -Text "(提示: 粘贴完成后, 连续按三次回车结束输入)" -Color "DarkGray"
    Write-Host ""

    $lines          = [System.Collections.ArrayList]::new()
    $emptyCount     = 0

    while ($true) {

        $oneLine = Read-Host

        if ([string]::IsNullOrEmpty($oneLine)) {
            $emptyCount++

            if ($emptyCount -ge 2) {
                break
            }

            [void]$lines.Add("")
        }
        else {
            $emptyCount = 0
            [void]$lines.Add($oneLine)
        }
    }

    # 去除末尾空行
    while ($lines.Count -gt 0 -and [string]::IsNullOrWhiteSpace($lines[$lines.Count - 1])) {
        $lines.RemoveAt($lines.Count - 1)
    }

    return ($lines -join "`n")
}

# ============================================================
# 候选文件选择
# ============================================================

function Show-CandidateSelection {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FileName,

        [Parameter(Mandatory = $true)]
        [array]$Candidates
    )

    Write-Host ""
    Write-Warning2 "  文件 '$FileName' 存在多个匹配:"
    Write-Host ""

    for ($i = 0; $i -lt $Candidates.Count; $i++) {
        $num = $i + 1
        Write-ColorText -Text "  [$num] " -Color "Cyan" -NoNewline
        Write-Info $Candidates[$i].relativePath
    }

    Write-ColorText -Text "  [0] " -Color "Red" -NoNewline
    Write-Info "跳过此文件"
    Write-ColorText -Text "  [A] " -Color "Magenta" -NoNewline
    Write-Info "全部选择"
    Write-Host ""
    Write-ColorText -Text "  请选择 (可用逗号分隔, 如 1,3) > " -Color "Green" -NoNewline

    $userChoice = Read-Host

    if ($userChoice.Trim().ToUpper() -eq 'A') {
        return $Candidates
    }

    if ($userChoice.Trim() -eq '0') {
        return @()
    }

    $selected = [System.Collections.ArrayList]::new()

    $parts = $userChoice.Trim().Split(',')
    foreach ($part in $parts) {
        $idx = 0
        if ([int]::TryParse($part.Trim(), [ref]$idx)) {
            if ($idx -ge 1 -and $idx -le $Candidates.Count) {
                [void]$selected.Add($Candidates[$idx - 1])
            }
        }
    }

    return $selected.ToArray()
}

# ============================================================
# 步骤进度
# ============================================================

function Write-ProgressStep {
    param(
        [Parameter(Mandatory = $true)]
        [string]$StepName,

        [Parameter(Mandatory = $true)]
        [string]$Status
    )

    Write-ColorText -Text "  >> " -Color "Cyan" -NoNewline
    Write-ColorText -Text "$StepName " -Color "White" -NoNewline
    Write-ColorText -Text "... " -Color "DarkGray" -NoNewline
    Write-Success $Status
}

# ============================================================
# 确认对话
# ============================================================

function Read-Confirmation {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [Parameter(Mandatory = $false)]
        [bool]$DefaultYes = $true
    )

    $hint = if ($DefaultYes) { "(Y/n)" } else { "(y/N)" }

    Write-ColorText -Text "  $Message $hint > " -Color "Yellow" -NoNewline
    $userChoice = Read-Host

    if ([string]::IsNullOrWhiteSpace($userChoice)) {
        return $DefaultYes
    }

    return ($userChoice.Trim().ToUpper() -eq 'Y')
}