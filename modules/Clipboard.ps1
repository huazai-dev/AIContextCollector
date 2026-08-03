<#
.SYNOPSIS
    剪贴板操作模块
.DESCRIPTION
    提供剪贴板复制功能
#>

# ============================================================
# 复制到剪贴板
# ============================================================

function Copy-ToClipboard {
    <#
    .SYNOPSIS
        将文本复制到Windows剪贴板
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    try {
        # 使用 .NET 方法
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        [System.Windows.Forms.Clipboard]::SetText($Text)

        Write-ProgressStep -StepName "已复制到剪贴板" -Status "OK"
        return $true
    }
    catch {
        try {
            # 回退方案: 使用 clip.exe
            $Text | clip.exe
            Write-ProgressStep -StepName "已复制到剪贴板" -Status "OK (clip.exe)"
            return $true
        }
        catch {
            Write-Error2 "复制到剪贴板失败: $_"
            return $false
        }
    }
}

# ============================================================
# 从剪贴板读取
# ============================================================

function Get-FromClipboard {
    <#
    .SYNOPSIS
        从剪贴板读取文本
    #>
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue

        if ([System.Windows.Forms.Clipboard]::ContainsText()) {
            return [System.Windows.Forms.Clipboard]::GetText()
        }

        return $null
    }
    catch {
        try {
            $content = Get-Clipboard -Raw -ErrorAction Stop
            return $content
        }
        catch {
            Write-Error2 "读取剪贴板失败: $_"
            return $null
        }
    }
}