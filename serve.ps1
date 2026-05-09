param(
  [int]$Port = 4173
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".svg" = "image/svg+xml"
  ".png" = "image/png"
}

function Send-Response {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$Status,
    [string]$ContentType,
    [byte[]]$Body
  )

  $reason = if ($Status -eq 200) { "OK" } else { "Not Found" }
  $headers = "HTTP/1.1 $Status $reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`n`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  $Stream.Write($Body, 0, $Body.Length)
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        continue
      }

      $parts = $requestLine.Split(" ")
      $path = [Uri]::UnescapeDataString($parts[1].Split("?")[0].TrimStart("/"))
      if ([string]::IsNullOrWhiteSpace($path)) {
        $path = "index.html"
      }

      $fullPath = Join-Path $root $path
      $resolved = Resolve-Path -LiteralPath $fullPath -ErrorAction SilentlyContinue
      if ($null -eq $resolved -or -not $resolved.Path.StartsWith($root)) {
        Send-Response $stream 404 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("Not found"))
        continue
      }

      $item = Get-Item -LiteralPath $resolved.Path
      if ($item.PSIsContainer) {
        $fullPath = Join-Path $item.FullName "index.html"
      } else {
        $fullPath = $item.FullName
      }

      if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        Send-Response $stream 404 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("Not found"))
        continue
      }

      $extension = [IO.Path]::GetExtension($fullPath)
      $contentType = $mime[$extension]
      if ($null -eq $contentType) {
        $contentType = "application/octet-stream"
      }

      Send-Response $stream 200 $contentType ([IO.File]::ReadAllBytes($fullPath))
    }
    finally {
      $client.Close()
    }
  }
}
finally {
  $listener.Stop()
}
