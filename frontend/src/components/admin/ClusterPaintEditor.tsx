import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, IconButton, Slider, Tooltip, Button, Typography, Divider,
} from '@mui/material';
import FormatPaintIcon from '@mui/icons-material/FormatPaint';
import BrushIcon from '@mui/icons-material/Brush';
import AutoFixOffIcon from '@mui/icons-material/AutoFixOff';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import Atrament, { MODE_DRAW, MODE_ERASE, MODE_DISABLED } from 'atrament';
import {
  floodFillFromSource, hexToRgb, rgbToHex,
  parseRgbString, getDistinctColor, computeClusterPercentages,
} from './clusterPaintUtils';
import type { PaletteEntry } from './clusterPaintUtils';
import type { ClusterReviewCluster, ManualClusterResponse } from '../../api/adminWvImportCvMatch';

type Tool = 'fill' | 'brush' | 'eraser';

interface Props {
  sourceImageUrl: string;
  overlayImageUrl?: string;
  initialClusters?: ClusterReviewCluster[];
  onConfirm: (response: ManualClusterResponse) => void;
  onCancel: () => void;
}

const MAX_HISTORY = 50;

export default function ClusterPaintEditor({
  sourceImageUrl, overlayImageUrl, initialClusters, onConfirm, onCancel,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const atramentRef = useRef<Atrament | null>(null);
  const sourceDataRef = useRef<ImageData | null>(null);

  const [tool, setTool] = useState<Tool>('fill');
  const [brushSize, setBrushSize] = useState(12);
  const [fillTolerance, setFillTolerance] = useState(30);
  const [overlayOpacity, setOverlayOpacity] = useState(55);
  const [zoom, setZoom] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [activeLabel, setActiveLabel] = useState<number>(-1);
  const [pcts, setPcts] = useState<Map<number, number>>(new Map());
  const [isPanning, setIsPanning] = useState(false);

  const historyRef = useRef<ImageData[]>([]);
  const historyIdxRef = useRef(-1);

  // Use ref for palette to avoid stale closures in callbacks
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  // Initialize palette from CV clusters (fix mode) or empty (scratch)
  useEffect(() => {
    if (initialClusters && initialClusters.length > 0) {
      const entries: PaletteEntry[] = initialClusters.map(c => ({
        label: c.label,
        color: parseRgbString(c.color),
      }));
      setPalette(entries);
      setActiveLabel(entries[0].label);
    }
  }, [initialClusters]);

  // Load source image into hidden canvas for flood fill
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setCanvasSize({ w: img.naturalWidth, h: img.naturalHeight });
      const sc = sourceCanvasRef.current;
      if (!sc) return;
      sc.width = img.naturalWidth;
      sc.height = img.naturalHeight;
      const ctx = sc.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      sourceDataRef.current = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
    };
    img.src = sourceImageUrl;
  }, [sourceImageUrl]);

  // Undo/redo + snapshot helpers (defined before Atrament setup which uses saveSnapshot)
  const updatePercentages = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || paletteRef.current.length === 0) return;
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setPcts(computeClusterPercentages(data, paletteRef.current));
  }, []);

  const saveSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(snap);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
    updatePercentages();
  }, [updatePercentages]);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')!.putImageData(historyRef.current[historyIdxRef.current], 0, 0);
    updatePercentages();
  }, [updatePercentages]);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')!.putImageData(historyRef.current[historyIdxRef.current], 0, 0);
    updatePercentages();
  }, [updatePercentages]);

  // Initialize Atrament on overlay canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.w === 0) return;
    canvas.width = canvasSize.w;
    canvas.height = canvasSize.h;

    if (overlayImageUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvasSize.w, canvasSize.h);
        saveSnapshot();
      };
      img.src = overlayImageUrl;
    } else {
      saveSnapshot();
    }

    const at = new Atrament(canvas, { color: '#000000' });
    at.weight = brushSize;
    at.smoothing = 0.5;
    at.adaptiveStroke = false;
    at.mode = MODE_DISABLED;
    atramentRef.current = at;
    at.addEventListener('strokeend', () => saveSnapshot());

    return () => { at.destroy(); atramentRef.current = null; };
  }, [canvasSize.w, canvasSize.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync tool → Atrament mode
  useEffect(() => {
    const at = atramentRef.current;
    if (!at) return;
    if (tool === 'brush') {
      at.mode = MODE_DRAW;
      const entry = palette.find(p => p.label === activeLabel);
      if (entry) at.color = rgbToHex(...entry.color);
    } else if (tool === 'eraser') {
      at.mode = MODE_ERASE;
    } else {
      at.mode = MODE_DISABLED;
    }
    at.weight = brushSize;
  }, [tool, brushSize, activeLabel, palette]);

  // Flood fill click handler
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'fill' || activeLabel < 0) return;
    const canvas = canvasRef.current;
    const sourceData = sourceDataRef.current;
    if (!canvas || !sourceData) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    const ctx = canvas.getContext('2d')!;
    const overlayData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const entry = paletteRef.current.find(p => p.label === activeLabel);
    if (!entry) return;

    floodFillFromSource(
      sourceData, overlayData, x, y,
      [entry.color[0], entry.color[1], entry.color[2], 200],
      fillTolerance,
    );
    ctx.putImageData(overlayData, 0, 0);
    saveSnapshot();
  }, [tool, activeLabel, fillTolerance, saveSnapshot]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'f' || e.key === 'F') { setTool('fill'); e.preventDefault(); return; }
    if (e.key === 'b' || e.key === 'B') { setTool('brush'); e.preventDefault(); return; }
    if (e.key === 'e' || e.key === 'E') { setTool('eraser'); e.preventDefault(); return; }
    if (e.key === 'z' && mod && !e.shiftKey) { undo(); e.preventDefault(); return; }
    if ((e.key === 'z' && mod && e.shiftKey) || (e.key === 'Z' && mod)) { redo(); e.preventDefault(); return; }
    if (e.key === '[') { setBrushSize(s => Math.max(1, s - 2)); return; }
    if (e.key === ']') { setBrushSize(s => Math.min(100, s + 2)); return; }
    if (e.key === ' ') { setIsPanning(true); e.preventDefault(); return; }
    const digit = parseInt(e.key);
    if (digit >= 1 && digit <= paletteRef.current.length) setActiveLabel(paletteRef.current[digit - 1].label);
  }, [undo, redo]);

  useEffect(() => {
    const upHandler = (e: KeyboardEvent) => { if (e.key === ' ') setIsPanning(false); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', upHandler);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', upHandler); };
  }, [handleKeyDown]);

  // Zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(5, Math.max(0.25, z + (e.deltaY > 0 ? -0.1 : 0.1))));
  }, []);

  // Pan
  const panRef = useRef({ startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !wrapperRef.current) return;
    const el = wrapperRef.current;
    panRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
  }, [isPanning]);
  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !wrapperRef.current || e.buttons === 0) return;
    const el = wrapperRef.current;
    el.scrollLeft = panRef.current.scrollLeft - (e.clientX - panRef.current.startX);
    el.scrollTop = panRef.current.scrollTop - (e.clientY - panRef.current.startY);
  }, [isPanning]);

  // Palette management
  const addCluster = useCallback(() => {
    const nextLabel = palette.length > 0 ? Math.max(...palette.map(p => p.label)) + 1 : 0;
    const color = hexToRgb(getDistinctColor(nextLabel));
    setPalette(prev => [...prev, { label: nextLabel, color }]);
    setActiveLabel(nextLabel);
  }, [palette]);

  const removeCluster = useCallback((label: number) => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d')!;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const entry = palette.find(p => p.label === label);
      if (entry) {
        for (let i = 0; i < data.data.length; i += 4) {
          const dr = Math.abs(data.data[i] - entry.color[0]);
          const dg = Math.abs(data.data[i + 1] - entry.color[1]);
          const db = Math.abs(data.data[i + 2] - entry.color[2]);
          if (dr < 10 && dg < 10 && db < 10 && data.data[i + 3] > 0) {
            data.data[i + 3] = 0;
          }
        }
        ctx.putImageData(data, 0, 0);
        saveSnapshot();
      }
    }
    setPalette(prev => prev.filter(p => p.label !== label));
    if (activeLabel === label) {
      const remaining = palette.filter(p => p.label !== label);
      setActiveLabel(remaining.length > 0 ? remaining[0].label : -1);
    }
  }, [palette, activeLabel, saveSnapshot]);

  // Submit
  const handleConfirm = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || palette.length === 0) return;
    const dataUrl = canvas.toDataURL('image/png');
    onConfirm({
      type: 'manual_clusters',
      overlayPng: dataUrl,
      palette: palette.map(p => ({ label: p.label, color: p.color })),
    });
  }, [palette, onConfirm]);

  // Derived values for cursor style
  let wrapperCursor = 'default';
  if (isPanning) wrapperCursor = 'grab';
  else if (tool === 'fill') wrapperCursor = 'crosshair';

  let canvasCursor: string | undefined;
  if (isPanning) canvasCursor = 'grab';
  else if (tool === 'fill') canvasCursor = 'crosshair';

  // Render
  return (
    <Box sx={{ display: 'flex', height: '70vh', border: '2px solid', borderColor: 'info.main', borderRadius: 1, overflow: 'hidden' }}>
      {/* Left toolbar */}
      <Box sx={{ width: 56, bgcolor: 'grey.100', display: 'flex', flexDirection: 'column', alignItems: 'center', p: 1, gap: 0.5, borderRight: 1, borderColor: 'divider' }}>
        <Tooltip title="Paint bucket (F)" placement="right">
          <IconButton size="small" color={tool === 'fill' ? 'primary' : 'default'} onClick={() => setTool('fill')}>
            <FormatPaintIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Brush (B)" placement="right">
          <IconButton size="small" color={tool === 'brush' ? 'primary' : 'default'} onClick={() => setTool('brush')}>
            <BrushIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Eraser (E)" placement="right">
          <IconButton size="small" color={tool === 'eraser' ? 'primary' : 'default'} onClick={() => setTool('eraser')}>
            <AutoFixOffIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Divider flexItem sx={{ my: 0.5 }} />
        <Tooltip title="Undo (Ctrl+Z)" placement="right">
          <IconButton size="small" onClick={undo}><UndoIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Redo (Ctrl+Shift+Z)" placement="right">
          <IconButton size="small" onClick={redo}><RedoIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Divider flexItem sx={{ my: 0.5 }} />
        <Typography variant="caption" color="text.secondary">Size</Typography>
        <Slider orientation="vertical" size="small" min={1} max={60} value={brushSize}
          onChange={(_, v) => setBrushSize(v as number)} sx={{ height: 80 }} />
        <Typography variant="caption">{brushSize}px</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">Fill tol.</Typography>
        <Slider orientation="vertical" size="small" min={0} max={100} value={fillTolerance}
          onChange={(_, v) => setFillTolerance(v as number)} sx={{ height: 60 }} />
        <Typography variant="caption">{fillTolerance}</Typography>
      </Box>

      {/* Center canvas */}
      <Box ref={wrapperRef} onWheel={handleWheel} onMouseDown={handlePanStart} onMouseMove={handlePanMove}
        sx={{ flex: 1, overflow: 'auto', position: 'relative', bgcolor: '#1a1a2e',
          cursor: wrapperCursor }}>
        <Box sx={{ transform: `scale(${zoom})`, transformOrigin: '0 0', position: 'relative', width: canvasSize.w, height: canvasSize.h }}>
          {sourceImageUrl && (
            <img src={sourceImageUrl} alt="Source map"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
          )}
          <canvas ref={canvasRef} onClick={handleCanvasClick}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              opacity: overlayOpacity / 100,
              cursor: canvasCursor }} />
          <canvas ref={sourceCanvasRef} style={{ display: 'none' }} />
        </Box>
        <Typography variant="caption"
          sx={{ position: 'absolute', bottom: 8, right: 8, bgcolor: 'rgba(0,0,0,0.6)', color: '#ccc', px: 1, borderRadius: 1 }}>
          {Math.round(zoom * 100)}% — scroll to zoom, Space+drag to pan
        </Typography>
      </Box>

      {/* Right palette */}
      <Box sx={{ width: 200, bgcolor: 'grey.50', borderLeft: 1, borderColor: 'divider', p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5, overflowY: 'auto' }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, mb: 0.5 }}>
          Clusters
        </Typography>
        {palette.map((entry, idx) => (
          <Box key={entry.label} onClick={() => setActiveLabel(entry.label)}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75, borderRadius: 1, cursor: 'pointer',
              border: '2px solid', borderColor: entry.label === activeLabel ? 'primary.main' : 'transparent',
              bgcolor: entry.label === activeLabel ? 'primary.50' : 'transparent',
              '&:hover': { bgcolor: 'grey.200' } }}>
            <Box sx={{ width: 24, height: 24, borderRadius: 0.5, flexShrink: 0,
              bgcolor: rgbToHex(...entry.color),
              border: entry.label === activeLabel ? '2px solid white' : undefined,
              boxShadow: entry.label === activeLabel ? '0 0 0 1px rgba(0,0,0,0.3)' : undefined }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>Cluster {idx + 1}</Typography>
              <Typography variant="caption" color="text.secondary">
                {pcts.get(entry.label)?.toFixed(1) ?? '0.0'}%
              </Typography>
            </Box>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); removeCluster(entry.label); }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addCluster} sx={{ mt: 0.5 }}>
          Add cluster
        </Button>
        <Box sx={{ flex: 1 }} />
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">Overlay opacity</Typography>
          <Slider size="small" min={0} max={100} value={overlayOpacity}
            onChange={(_, v) => setOverlayOpacity(v as number)} />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Button variant="contained" color="info" size="small" disabled={palette.length === 0} onClick={handleConfirm}>
            Confirm clusters
          </Button>
          <Button variant="outlined" size="small" color="inherit" onClick={onCancel}>
            Back to review
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
