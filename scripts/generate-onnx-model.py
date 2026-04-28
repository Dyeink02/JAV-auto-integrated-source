"""
Generate MobileNetV3 Small ONNX model for JAV ad detection.

This script:
1. Loads a pre-trained torchvision MobileNetV3 Small
2. Adds a feature extraction output (1280-dim embedding)
3. Exports to ONNX format with opset 17
4. Saves to desktop/resources/models/mobile-net-v3-small.onnx

Requires: torch, torchvision
Install:  pip install torch torchvision onnx

Usage:  python scripts/generate-onnx-model.py
"""

import os
import sys

def main():
    try:
        import torch
        import torchvision
        import onnx
    except ImportError as e:
        print(f"缺少依赖: {e}")
        print("请运行: pip install torch torchvision onnx")
        sys.exit(1)

    # ── Load pre-trained MobileNetV3 Small ──────────────────────────────
    print("下载预训练 MobileNetV3 Small 模型...")
    model = torchvision.models.mobilenet_v3_small(
        weights=torchvision.models.MobileNet_V3_Small_Weights.IMAGENET1K_V1
    )
    model.eval()

    # ── Build a wrapper that outputs both classification AND embedding ──
    class MobileNetV3WithEmbedding(torch.nn.Module):
        def __init__(self, base_model):
            super().__init__()
            self.features = base_model.features
            self.avgpool = base_model.avgpool
            # After avgpool: [B, 576, 1, 1] → flatten → [B, 576]
            self.classifier = base_model.classifier
            # classifier: 0: Linear(576→1024), 1: Hardsigmoid, 2: Dropout, 3: Linear(1024→1000)

        def forward(self, x):
            x = self.features(x)
            x = self.avgpool(x)
            embedding = torch.flatten(x, 1)  # [B, 576]

            x = self.classifier[0](embedding)  # Linear → 1024
            x = self.classifier[1](x)          # Hardsigmoid
            x = self.classifier[2](x)          # Dropout (skip during eval)
            logits = self.classifier[3](x)     # Linear → 1000

            return logits, embedding

    wrapper = MobileNetV3WithEmbedding(model)

    # ── Export to ONNX ───────────────────────────────────────────────────
    output_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "desktop", "resources", "models"
    )
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "mobile-net-v3-small.onnx")

    dummy_input = torch.randn(1, 3, 224, 224)

    print(f"导出 ONNX 模型到: {output_path}")
    torch.onnx.export(
        wrapper,
        dummy_input,
        output_path,
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["logits", "embedding"],
        dynamic_axes={
            "input": {0: "batch_size"},
            "logits": {0: "batch_size"},
            "embedding": {0: "batch_size"},
        },
    )

    # ── Verify ───────────────────────────────────────────────────────────
    onnx_model = onnx.load(output_path)
    onnx.checker.check_model(onnx_model)
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"✓ 模型生成成功: {size_mb:.1f} MB")
    print(f"  输入:  input [B, 3, 224, 224]")
    print(f"  输出:  logits [B, 1000] (分类)")
    print(f"  输出:  embedding [B, 576] (特征向量，用于广告检测)")
    print(f"\n下一步: 正常构建 EXE，模型将自动打包。")

if __name__ == "__main__":
    main()
