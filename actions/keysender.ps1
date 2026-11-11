# Читает JSON-команды из stdin и нажимает клавиши через SendInput.
# Формат строки: {"window":"regex заголовка окна","ops":[["s",41],["w",400],["u","text"]]}
#   s = нажатие по скан-коду, w = пауза в мс, u = ввод текста юникодом.
# Клавиши уходят, только если заголовок активного окна подходит под window.
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class KS {
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit, Size = 40)]
    struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);

    const uint KEYUP = 0x0002, UNICODE = 0x0004, SCANCODE = 0x0008;

    public static string Title() {
        var sb = new StringBuilder(512);
        GetWindowText(GetForegroundWindow(), sb, sb.Capacity);
        return sb.ToString();
    }

    static void Key(ushort scan, uint flags) {
        var input = new INPUT[1];
        input[0].type = 1;
        input[0].ki.wScan = scan;
        input[0].ki.dwFlags = flags;
        SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Scan(ushort sc, int hold) {
        Key(sc, SCANCODE);
        Thread.Sleep(hold);
        Key(sc, SCANCODE | KEYUP);
    }

    public static void Uni(string text, int delay) {
        foreach (char c in text) {
            Key(c, UNICODE);
            Key(c, UNICODE | KEYUP);
            Thread.Sleep(delay);
        }
    }
}
'@

[Console]::Out.WriteLine('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
    try {
        $cmd = $line | ConvertFrom-Json
        $title = [KS]::Title()
        if (-not $cmd.window -or $title -notmatch $cmd.window) {
            [Console]::Out.WriteLine('skip:' + $title)
            continue
        }
        foreach ($op in $cmd.ops) {
            switch ($op[0]) {
                's' { [KS]::Scan([uint16]$op[1], 35); Start-Sleep -Milliseconds 25 }
                'w' { Start-Sleep -Milliseconds ([int]$op[1]) }
                'u' { [KS]::Uni([string]$op[1], 8) }
            }
        }
        [Console]::Out.WriteLine('ok')
    } catch {
        [Console]::Out.WriteLine('err:' + $_.Exception.Message)
    }
}
