'use strict';

/**
 * 视频风格配方（海报渲染 + ffmpeg 调色 + 音频 + Seedance 提示词标签共用）
 */
const STYLES = {
  cinematic: {
    id: 'cinematic',
    name: '电影写实',
    en: 'Cinematic',
    desc: '电影级光影与胶片色调，浅景深质感',
    colors: ['#0d1a24', '#26343f', '#5d4a35'], // 海报渐变（上→下）
    accent: '#e8b45a',
    glow: '#e8b45a',
    deco: 'cinematic',
    letterbox: true,
    promptTag: '电影写实风格，胶片质感，自然光影，浅景深，35mm镜头',
    qualityTag: '电影级画面，细节丰富，光影层次分明，构图考究',
    grade: 'eq=saturation=1.12:contrast=1.06:brightness=-0.015,vignette=PI/4.6',
    zoom: { z: '1+0.11*on/FR', x: '(iw-iw/zoom)/2', y: '(ih-ih/zoom)/2-8' },
    audio: { freqs: [110, 164.8], tremolo: '0.22:0.55', lp: 620, vol: 0.30 },
  },
  xianxia: {
    id: 'xianxia',
    name: '古装仙侠',
    en: 'Xianxia',
    desc: '水墨意境，仙气缥缈，柔和金青色调',
    colors: ['#123048', '#2d5a77', '#c9a86a'],
    accent: '#f2d49b',
    glow: '#9fd8e8',
    deco: 'xianxia',
    letterbox: false,
    promptTag: '古装仙侠风格，水墨意境，云雾缭绕，衣袂飘飘',
    qualityTag: '国风美学，光线柔和，色彩雅致，画面干净通透',
    grade: 'eq=saturation=1.22:contrast=0.98:brightness=0.03,vignette=PI/5.2',
    zoom: { z: '1+0.07*on/FR', x: '(iw-iw/zoom)/2+30*sin(on/40)', y: '(ih-ih/zoom)/2-4' },
    audio: { freqs: [220, 277.2, 329.6], tremolo: '0.5:0.3', lp: 1800, vol: 0.22 },
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: '赛博朋克',
    en: 'Cyberpunk',
    desc: '霓虹灯海，未来都市，高饱和撞色',
    colors: ['#0b0821', '#1b1145', '#0e3a4d'],
    accent: '#00e5ff',
    glow: '#ff2bd6',
    deco: 'cyberpunk',
    letterbox: false,
    promptTag: '赛博朋克风格，霓虹灯光，未来都市夜景，雨夜反光',
    qualityTag: '霓虹色调，高对比，科技感十足，暗部细节丰富',
    grade: "eq=saturation=1.55:contrast=1.14,hue=H=0.018*sin(2*PI*t/7):s=1.5,vignette=PI/4.2",
    zoom: { z: '1+0.16*on/FR', x: '(iw-iw/zoom)/2+50*sin(on/28)', y: '(ih-ih/zoom)/2' },
    audio: { freqs: [98, 146.8], tremolo: '5:0.75', lp: 480, vol: 0.26 },
  },
  anime: {
    id: 'anime',
    name: '清新动画',
    en: 'Anime',
    desc: '日系动画质感，明亮清新，治愈色板',
    colors: ['#7ec8e3', '#f6c6ea', '#fdf3d8'],
    accent: '#ff8fb1',
    glow: '#ffe9a8',
    deco: 'anime',
    letterbox: false,
    promptTag: '日系清新动画风格，手绘质感，明亮色彩，治愈氛围',
    qualityTag: '动画电影质感，线条干净，色彩明快，构图简洁',
    grade: 'eq=saturation=1.45:contrast=1.04:brightness=0.06,vignette=PI/5.6',
    zoom: { z: '1+0.09*on/FR', x: '(iw-iw/zoom)/2', y: '(ih-ih/zoom)/2+14*sin(on/36)' },
    audio: { freqs: [523.3, 659.3, 784], tremolo: '4.5:0.45', lp: 3200, vol: 0.18 },
  },
  noir: {
    id: 'noir',
    name: '黑白悬疑',
    en: 'Noir',
    desc: '黑白胶片，硬朗光影，复古默片气质',
    colors: ['#0a0a0c', '#1f2024', '#3a3d42'],
    accent: '#d8d8d8',
    glow: '#8b8b8b',
    deco: 'noir',
    letterbox: true,
    promptTag: '黑白电影风格，复古胶片颗粒，硬朗光影，悬疑氛围',
    qualityTag: '黑白质感，高反差布光，颗粒感胶片，经典黑色电影构图',
    grade: "hue=s=0,eq=contrast=1.24:brightness=-0.035,noise=alls=12:allf=t+u,vignette=PI/4.0",
    zoom: { z: '1.12-0.09*on/FR', x: '(iw-iw/zoom)/2', y: '(ih-ih/zoom)/2' },
    audio: { freqs: [55], tremolo: null, lp: 300, vol: 0.30, noise: true },
  },
  thriller: {
    id: 'thriller',
    name: '悬疑惊悚',
    en: 'Thriller',
    desc: '冷峻色调，紧张节奏，压迫感氛围',
    colors: ['#050a08', '#0e2018', '#1d3226'],
    accent: '#ff4d3d',
    glow: '#7ddb8c',
    deco: 'thriller',
    letterbox: false,
    promptTag: '悬疑惊悚风格，冷峻色调，压抑氛围，阴郁光线',
    qualityTag: '紧张感构图，暗调光影，环境音氛围，悬疑电影质感',
    grade: "eq=saturation=0.72:contrast=1.15:brightness=-0.02+0.05*sin(2*PI*t/1.7),vignette=PI/3.6",
    zoom: { z: '1+0.2*on/FR', x: '(iw-iw/zoom)/2+10*sin(on/13)', y: '(ih-ih/zoom)/2+8*sin(on/19)' },
    audio: { freqs: [82.4, 83.6], tremolo: null, lp: 220, vol: 0.30 },
  },
};

const STYLE_IDS = Object.keys(STYLES);

const RESOLUTIONS = {
  '480p': { w: 854, h: 480, label: '480P 标清' },
  '720p': { w: 1280, h: 720, label: '720P 高清' },
  '1080p': { w: 1920, h: 1080, label: '1080P 全高清' },
};

const RATIOS = {
  '16:9': { w: 16, h: 9, label: '16:9 横屏' },
  '9:16': { w: 9, h: 16, label: '9:16 竖屏' },
  '1:1': { w: 1, h: 1, label: '1:1 方形' },
};

/** 按分辨率和比例计算画幅（长边对齐分辨率高度/宽度） */
function frameSize(resolution, ratio) {
  const res = RESOLUTIONS[resolution] || RESOLUTIONS['720p'];
  const r = RATIOS[ratio] || RATIOS['16:9'];
  const rw = r.w, rh = r.h;
  let w, h;
  if (rw >= rh) {
    h = res.h;
    w = Math.round((h * rw) / rh) & ~1;
  } else {
    // 竖屏：短边 = 分辨率高度（720p → 720×1280）
    w = res.h;
    h = Math.round((w * rh) / rw) & ~1;
  }
  return { w, h };
}

module.exports = { STYLES, STYLE_IDS, RESOLUTIONS, RATIOS, frameSize };
