$file = "e:\ai jav\JAV auto\JAV-auto-integrated-source\desktop\mainServices\adLearning\videoFrameProcessor.js"
$content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

$oldMarker = '    buildVideoHashes'
$newText = @'
  /**
   * Extracts 224x224 RGB frames from a video for ONNX inference.
   * Returns raw RGB pixel buffers for each frame.
   * @param {string} videoPath
   * @param {number[]} frameSeconds
   * @returns {Promise<{ frames: Array<{ frameSecond: number, rgb: number[] }> }>}
   */
  async function extractOnnxFrames(videoPath, frameSeconds) {
    const normalizedSeconds = normalizeFrameSeconds(frameSeconds);
    const results = await Promise.allSettled(
      normalizedSeconds.map((second) => hashCalculator.computeVideoFrameRgb(videoPath, second))
    );
    const frames = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== 'fulfilled' || !result.value) continue;
      const rgb = Array.from(result.value);
      frames.push({ frameSecond: normalizedSeconds[i], rgb });
    }
    return { frames };
  }

  return {
    clamp,
    emitProgress,
    shouldReportProgress,
    collectVideoFiles,
    collectVideoFilesWithManagedFallback,
    detectFilmCodeFromPath,
    buildVideoHashes,
    extractOnnxFrames
  };
'@

$oldReturn = @'
  return {
    clamp,
    emitProgress,
    shouldReportProgress,
    collectVideoFiles,
    collectVideoFilesWithManagedFallback,
    detectFilmCodeFromPath,
    buildVideoHashes
  };
'@

$content = $content.Replace($oldReturn, $newText)
[System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
Write-Host "OK"
