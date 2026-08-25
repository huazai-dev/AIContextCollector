#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
短剧分镜海报渲染器（Pillow）
用法: python3 poster.py --spec spec.json --out out.png
spec 字段见 README / lib/mockEngine.js 的 buildPosterSpec()
"""
import json
import math
import os
import random
import sys
import argparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'vendor'))

from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgrad(w, h, stops):
    """垂直三色渐变，返回 RGB 图像"""
    img = Image.new('RGB', (w, h))
    px = img.load()
    n = len(stops) - 1
    for y in range(h):
        t = y / max(1, h - 1) * n
        i = min(int(t), n - 1)
        c = lerp(stops[i], stops[i + 1], t - i)
        for x in range(0, w):
            px[x, y] = c
    return img


def wrap(draw, text, font, maxw):
    if not text:
        return []
    lines, cur = [], ''
    for ch in text:
        if ch == '\n':
            lines.append(cur); cur = ''; continue
        if draw.textlength(cur + ch, font=font) > maxw and cur:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def add_grain(img, rng, amount=900, alpha=16, mono=True):
    ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    w, h = img.size
    for _ in range(amount):
        x, y = rng.randrange(w), rng.randrange(h)
        g = rng.randrange(255) if mono else None
        if mono:
            c = (g, g, g, rng.randrange(alpha))
        else:
            c = (rng.randrange(255), rng.randrange(255), rng.randrange(255), rng.randrange(alpha))
        d.point((x, y), fill=c)
    img.paste(Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB'), (0, 0))
    return img


def add_vignette(img, strength=110):
    w, h = img.size
    ov = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(ov)
    d.ellipse((w * 0.1, h * 0.1, w * 0.9, h * 0.9), fill=255)
    ov = ov.filter(ImageFilter.GaussianBlur(max(w, h) // 8))
    dark = Image.new('RGB', (w, h), (0, 0, 0))
    mask = ov.point(lambda p: round((255 - p) * strength / 255))
    return Image.composite(dark, img, mask)


def deco(draw, img, spec, rng, w, h, acc, glow):
    style = spec.get('deco', 'cinematic')
    if style == 'cinematic':
        # 对角线光束 + 光斑
        beam = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        bd = ImageDraw.Draw(beam)
        bd.polygon([(w * 0.1, 0), (w * 0.32, 0), (w * 0.62, h), (w * 0.38, h)], fill=acc + (26,))
        beam = beam.filter(ImageFilter.GaussianBlur(w // 20))
        img.paste(Image.alpha_composite(img.convert('RGBA'), beam).convert('RGB'), (0, 0))
        for _ in range(9):
            x, y = rng.randrange(w), rng.randrange(int(h * 0.7))
            r = rng.randrange(w // 90, w // 24)
            ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
            ImageDraw.Draw(ov).ellipse((x - r, y - r, x + r, y + r), fill=acc + (rng.randrange(28, 70),))
            img.paste(Image.alpha_composite(img.convert('RGBA'), ov.filter(ImageFilter.GaussianBlur(r // 2))).convert('RGB'), (0, 0))
        # 底部暗角
        ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        for i in range(6):
            a = 20 - i * 2
            od.rectangle((0, h - (i + 1) * h // 14, w, h - i * h // 14), fill=(0, 0, 0, max(a, 0)))
        img.paste(Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB'), (0, 0))
    elif style == 'xianxia':
        # 顶部柔光 + 雾带 + 漂浮光点
        glowimg = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glowimg)
        gd.ellipse((w * 0.2, -h * 0.35, w * 0.8, h * 0.35), fill=glow + (70,))
        img.paste(Image.alpha_composite(img.convert('RGBA'), glowimg.filter(ImageFilter.GaussianBlur(w // 12))).convert('RGB'), (0, 0))
        for i in range(4):
            y = h * (0.25 + 0.16 * i)
            ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
            ImageDraw.Draw(ov).rounded_rectangle((w * 0.08, y, w * 0.92, y + h * 0.045), radius=h // 40,
                                                 fill=(255, 255, 255, 26 - i * 5))
            img.paste(Image.alpha_composite(img.convert('RGBA'), ov.filter(ImageFilter.GaussianBlur(h // 30))).convert('RGB'), (0, 0))
        for _ in range(26):
            x, y = rng.randrange(w), rng.randrange(h)
            r = rng.randrange(2, 6)
            ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
            ImageDraw.Draw(ov).ellipse((x - r, y - r, x + r, y + r), fill=(255, 240, 210, rng.randrange(90, 190)))
            img.paste(Image.alpha_composite(img.convert('RGBA'), ov.filter(ImageFilter.GaussianBlur(2))).convert('RGB'), (0, 0))
    elif style == 'cyberpunk':
        # 扫描线 + 透视网格 + 霓虹环
        scan = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        sd = ImageDraw.Draw(scan)
        for y in range(0, h, 4):
            sd.line((0, y, w, y), fill=(0, 0, 0, 70), width=1)
        img.paste(Image.alpha_composite(img.convert('RGBA'), scan).convert('RGB'), (0, 0))
        grid = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        gd = ImageDraw.Draw(grid)
        vp = (w // 2, int(h * 0.52))
        for i in range(9):
            x = w * (0.02 + 0.12 * i)
            gd.line((vp[0], vp[1], x, h), fill=acc + (80,), width=2)
        for j in range(6):
            y = vp[1] + (h - vp[1]) * (0.18 + 0.16 * j)
            gd.line((0, y, w, y), fill=acc + (40,), width=1)
        img.paste(Image.alpha_composite(img.convert('RGBA'), grid).convert('RGB'), (0, 0))
        ring = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        rd = ImageDraw.Draw(ring)
        cx, cy, r = w // 2, int(h * 0.52), int(h * 0.62)
        rd.arc((cx - r, cy - r, cx + r, cy + r), 200, 340, fill=glow + (140,), width=max(2, h // 120))
        rd.arc((cx - r, cy - r, cx + r, cy + r), 20, 160, fill=acc + (150,), width=max(2, h // 120))
        img.paste(Image.alpha_composite(img.convert('RGBA'), ring).convert('RGB'), (0, 0))
    elif style == 'anime':
        # 大柔圆 + 星光 + 斜飘带
        ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(ov).ellipse((w * 0.55, -h * 0.3, w * 1.15, h * 0.55), fill=glow + (120,))
        img.paste(Image.alpha_composite(img.convert('RGBA'), ov.filter(ImageFilter.GaussianBlur(w // 30))).convert('RGB'), (0, 0))
        for _ in range(14):
            x, y = rng.randrange(w), rng.randrange(int(h * 0.6))
            r = rng.randrange(3, 9)
            ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
            od = ImageDraw.Draw(ov)
            od.polygon([(x, y - r * 2), (x + r // 2, y - r // 2), (x + r * 2, y), (x + r // 2, y + r // 2), (x, y + r * 2),
                        (x - r // 2, y + r // 2), (x - r * 2, y), (x - r // 2, y - r // 2)], fill=(255, 255, 255, 200))
            img.paste(Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB'), (0, 0))
    elif style == 'noir':
        # 顶光锥 + 划痕 + 重颗粒
        ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(ov).polygon([(w * 0.34, 0), (w * 0.66, 0), (w * 0.92, h), (w * 0.08, h)], fill=(255, 255, 255, 30))
        img.paste(Image.alpha_composite(img.convert('RGBA'), ov.filter(ImageFilter.GaussianBlur(w // 16))).convert('RGB'), (0, 0))
        for _ in range(6):
            x = rng.randrange(w)
            ln = rng.randrange(h // 60, h // 12)
            y = rng.randrange(h)
            draw.line((x, y, x, y + ln), fill=(255, 255, 255), width=1)
    elif style == 'thriller':
        # 红色斜切 + 暗影椭圆 + 颗粒
        ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        for i in range(3):
            od.line((-w * 0.2, h * (0.3 + 0.2 * i), w * 1.2, h * (0.14 + 0.2 * i)),
                    fill=acc + (36 - i * 8,), width=max(2, h // 40))
        img.paste(Image.alpha_composite(img.convert('RGBA'), ov.filter(ImageFilter.GaussianBlur(8))).convert('RGB'), (0, 0))
        ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(ov).ellipse((w * 0.3, h * 0.34, w * 0.7, h * 0.78), fill=(0, 0, 0, 90))
        img.paste(Image.alpha_composite(img.convert('RGBA'), ov.filter(ImageFilter.GaussianBlur(w // 40))).convert('RGB'), (0, 0))
    return img


def draw_shot(spec):
    w, h = spec['w'], spec['h']
    rng = random.Random(spec.get('seed', 1))
    stops = [hex2rgb(c) for c in spec['colors']]
    acc = hex2rgb(spec['accent'])
    glow = hex2rgb(spec.get('glow', spec['accent']))
    img = vgrad(w, h, stops).convert('RGB')
    draw = ImageDraw.Draw(img, 'RGBA')
    img = deco(draw, img, spec, rng, w, h, acc, glow)
    img = add_grain(img, rng, amount=w * h // 2600, alpha=14)
    img = add_vignette(img, 92)
    draw = ImageDraw.Draw(img, 'RGBA')
    portrait = h > w
    s = max(w, h) / 1280.0
    font_path = spec['font']

    def F(size):
        return ImageFont.truetype(font_path, max(10, int(size * s)))

    f_small = F(24); f_chip = F(26); f_shot = F(150); f_shoten = F(34)
    f_scene = F(46); f_cam = F(32); f_quote = F(40); f_speaker = F(34); f_act = F(30)

    # 顶部栏
    draw.text((w * 0.05, h * 0.045), 'SEEDANCE 短剧工作室', font=f_small, fill=(255, 255, 255, 150))
    chip = f"  {spec['styleName']} · {spec['en']}  "
    cw = draw.textlength(chip, font=f_chip) + 24
    draw.rounded_rectangle((w - w * 0.05 - cw, h * 0.04, w - w * 0.05, h * 0.04 + 40 * s), radius=10,
                           fill=acc + (230,))
    draw.text((w - w * 0.05 - cw + 12, h * 0.04 + 4), chip, font=f_chip, fill=(12, 12, 18, 255))

    # 中心主标题
    cx = w // 2
    shot_txt = f"第 {spec['index']:02d} 镜"
    tw = draw.textlength(shot_txt, font=f_shot)
    ty = h * (0.30 if portrait else 0.34)
    draw.text((cx - tw / 2, ty), shot_txt, font=f_shot, fill=(255, 255, 255, 235))
    en_txt = f"SHOT {spec['index']:02d} / {spec['total']:02d}  ·  {spec['actLabel']}"
    etw = draw.textlength(en_txt, font=f_shoten)
    draw.text((cx - etw / 2, ty + 175 * s), en_txt, font=f_shoten, fill=acc + (255,))

    # 场景 / 运镜
    for i, (label, txt, font) in enumerate([('场景', spec.get('scene', ''), f_scene), ('运镜', spec.get('camera', ''), f_cam)]):
        if not txt:
            continue
        line = f"{label}｜{txt}"
        lw = draw.textlength(line, font=font)
        y = h * (0.52 if portrait else 0.56) + i * 58 * s
        draw.text((cx - lw / 2, y), line, font=font, fill=(255, 255, 255, 205))

    # 底部台词带
    dialogue = spec.get('dialogue', '')
    speaker = spec.get('speaker', '')
    band_h = 150 * s if dialogue else 84 * s
    by = h - band_h - h * 0.035
    draw.rounded_rectangle((w * 0.07, by, w * 0.93, by + band_h), radius=16, fill=(0, 0, 0, 130))
    draw.rectangle((w * 0.07, by + 8, w * 0.07 + 6, by + band_h - 8), fill=acc + (255,))
    if dialogue:
        q = f"“{dialogue}”"
        maxw = w * 0.8
        lines = wrap(draw, q, f_quote, maxw)
        y = by + 24 * s
        if speaker:
            sp = speaker
            draw.text((w * 0.1, y - 26 * s), sp, font=f_speaker, fill=acc + (255,))
        for ln in lines:
            lw = draw.textlength(ln, font=f_quote)
            draw.text((cx - lw / 2, y), ln, font=f_quote, fill=(255, 255, 255, 245))
            y += 52 * s
    else:
        act = f"—— {spec['actLabel']} · 情绪铺垫 ——"
        aw = draw.textlength(act, font=f_act)
        draw.text((cx - aw / 2, by + 26 * s), act, font=f_act, fill=(255, 255, 255, 190))
    return img


def draw_title(spec):
    w, h = spec['w'], spec['h']
    rng = random.Random(spec.get('seed', 7))
    stops = [hex2rgb(c) for c in spec['colors']]
    acc = hex2rgb(spec['accent'])
    glow = hex2rgb(spec.get('glow', spec['accent']))
    img = vgrad(w, h, stops).convert('RGB')
    draw = ImageDraw.Draw(img, 'RGBA')
    img = deco(draw, img, spec, rng, w, h, acc, glow)
    img = add_grain(img, rng, amount=w * h // 3000, alpha=12)
    img = add_vignette(img, 100)
    draw = ImageDraw.Draw(img, 'RGBA')
    s = max(w, h) / 1280.0
    font_path = spec['font']

    def F(size):
        return ImageFont.truetype(font_path, max(10, int(size * s)))

    f_tag = F(28); f_title = F(118); f_en = F(40); f_log = F(36); f_meta = F(30); f_brand = F(26)
    cx = w // 2
    draw.text((w * 0.05, h * 0.05), 'AI 短剧 · 分镜成片', font=f_brand, fill=(255, 255, 255, 140))
    tag = "SEEDANCE 2.0 PRESENTS"
    tw = draw.textlength(tag, font=f_tag)
    draw.text((cx - tw / 2, h * 0.16), tag, font=f_tag, fill=acc + (255,))
    title_lines = wrap(draw, spec.get('title', ''), f_title, w * 0.84)
    y = h * 0.26
    for ln in title_lines:
        lw = draw.textlength(ln, font=f_title)
        # 描边阴影
        draw.text((cx - lw / 2 + 4, y + 4), ln, font=f_title, fill=(0, 0, 0, 150))
        draw.text((cx - lw / 2, y), ln, font=f_title, fill=(255, 255, 255, 248))
        y += 132 * s
    en = spec.get('en', 'SHORT DRAMA')
    ew = draw.textlength(en, font=f_en)
    draw.text((cx - ew / 2, y + 8), en, font=f_en, fill=acc + (220,))
    log_lines = wrap(draw, spec.get('logline', ''), f_log, w * 0.7)
    ly = h * 0.68
    for ln in log_lines[:2]:
        lw = draw.textlength(ln, font=f_log)
        draw.text((cx - lw / 2, ly), ln, font=f_log, fill=(255, 255, 255, 190))
        ly += 48 * s
    meta = spec.get('meta', '')
    mw = draw.textlength(meta, font=f_meta)
    draw.text((cx - mw / 2, h - h * 0.09), meta, font=f_meta, fill=(255, 255, 255, 170))
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--spec', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    with open(args.spec, 'r', encoding='utf-8') as f:
        spec = json.load(f)
    img = draw_shot(spec) if spec.get('type') == 'shot' else draw_title(spec)
    img.save(args.out, 'PNG')
    print('ok')


if __name__ == '__main__':
    main()
