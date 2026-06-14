import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { removeBackground, type Config as RemoveBackgroundConfig } from "@imgly/background-removal";
import { wardrobeDb } from "./db";
import type { BackupPayload, Category, Outfit, OutfitPiece, Season, WardrobeItem } from "./types";

const categories: Category[] = ["上衣", "下装", "外套", "鞋子", "配饰"];
const seasons: Season[] = ["春秋", "夏季", "冬季", "四季"];
const colors = ["黑色", "白色", "灰色", "蓝色", "棕色", "米色", "绿色", "红色", "黄色", "粉色", "紫色"];

type Tab = "搭配" | "衣柜" | "收藏";

type DraftItem = {
  name: string;
  category: Category;
  color: string;
  season: Season;
  imageDataUrl: string;
};

const emptyDraft: DraftItem = {
  name: "",
  category: "上衣",
  color: "黑色",
  season: "四季",
  imageDataUrl: "",
};

const canvasPieceSize = 118;
const removeBackgroundConfig: RemoveBackgroundConfig = {
  device: "cpu",
  model: "isnet_fp16",
  output: {
    format: "image/png",
    quality: 1,
  },
};

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("搭配");
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [canvasPieces, setCanvasPieces] = useState<OutfitPiece[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | "全部">("全部");
  const [draft, setDraft] = useState<DraftItem>(emptyDraft);
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isCuttingOut, setIsCuttingOut] = useState(false);
  const [movingPieceId, setMovingPieceId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([wardrobeDb.getItems(), wardrobeDb.getOutfits()])
      .then(([storedItems, storedOutfits]) => {
        setItems(storedItems.sort((a, b) => b.createdAt - a.createdAt));
        setOutfits(storedOutfits.sort((a, b) => b.createdAt - a.createdAt));
      })
      .catch(() => setNotice("本地数据读取失败，请刷新后重试。"));
  }, []);

  const filteredItems = useMemo(() => {
    if (selectedCategory === "全部") return items;
    return items.filter((item) => item.category === selectedCategory);
  }, [items, selectedCategory]);

  const canvasItems = useMemo(() => {
    return canvasPieces
      .map((piece) => ({
        ...piece,
        item: items.find((item) => item.id === piece.itemId) ?? null,
      }))
      .filter((piece): piece is OutfitPiece & { item: WardrobeItem } => Boolean(piece.item));
  }, [canvasPieces, items]);

  const canSaveOutfit = canvasPieces.length > 0;

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsCuttingOut(true);
    showNotice("正在智能抠图，首次可能较慢。");
    try {
      const imageDataUrl = await createGarmentCutoutDataUrl(file);
      setDraft((current) => ({ ...current, imageDataUrl }));
      showNotice("背景已去除，衣物原色已保留。");
    } catch {
      const imageDataUrl = await readFileAsDataUrl(file);
      setDraft((current) => ({ ...current, imageDataUrl }));
      showNotice("自动抠图失败，已保留原图。");
    } finally {
      setIsCuttingOut(false);
      event.currentTarget.value = "";
    }
  }

  async function handleAddItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.imageDataUrl) {
      showNotice("请先拍照或上传衣物图片。");
      return;
    }

    const item: WardrobeItem = {
      id: crypto.randomUUID(),
      name: draft.name.trim() || `${draft.color}${draft.category}`,
      category: draft.category,
      color: draft.color,
      season: draft.season,
      imageDataUrl: draft.imageDataUrl,
      createdAt: Date.now(),
    };

    await wardrobeDb.saveItem(item);
    setItems((current) => [item, ...current]);
    setDraft(emptyDraft);
    showNotice("衣物已加入衣柜。");
  }

  async function handleDeleteItem(id: string) {
    await wardrobeDb.deleteItem(id);
    setItems((current) => current.filter((item) => item.id !== id));
    setCanvasPieces((current) => current.filter((piece) => piece.itemId !== id));
    showNotice("衣物已删除。");
  }

  function addItemToCanvas(item: WardrobeItem, position?: { x: number; y: number }) {
    setCanvasPieces((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        itemId: item.id,
        x: position?.x ?? 26 + (current.length % 3) * 54,
        y: position?.y ?? 28 + (current.length % 4) * 42,
      },
    ]);
  }

  function removePiece(id: string) {
    setCanvasPieces((current) => current.filter((piece) => piece.id !== id));
  }

  function handleDragStart(item: WardrobeItem, event: React.DragEvent<HTMLButtonElement>) {
    event.dataTransfer.setData("text/plain", item.id);
    event.dataTransfer.effectAllowed = "copy";
  }

  function handleCanvasDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const itemId = event.dataTransfer.getData("text/plain");
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    addItemToCanvas(item, clampCanvasPosition(event.clientX - rect.left - canvasPieceSize / 2, event.clientY - rect.top - canvasPieceSize / 2, rect));
  }

  function movePiece(id: string, event: React.PointerEvent<HTMLDivElement>) {
    if (!canvasRef.current || movingPieceId !== id) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const next = clampCanvasPosition(event.clientX - rect.left - canvasPieceSize / 2, event.clientY - rect.top - canvasPieceSize / 2, rect);
    setCanvasPieces((current) => current.map((piece) => (piece.id === id ? { ...piece, ...next } : piece)));
  }

  async function saveCurrentOutfit() {
    if (!canSaveOutfit || isSaving) return;
    setIsSaving(true);
    try {
      const outfit: Outfit = {
        id: crypto.randomUUID(),
        name: `搭配 ${new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}`,
        pieces: canvasPieces,
        createdAt: Date.now(),
      };

      await wardrobeDb.saveOutfit(outfit);
      setOutfits((current) => [outfit, ...current]);
      setCanvasPieces([]);
      showNotice("搭配已保存到收藏。");
    } catch {
      showNotice("搭配保存失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteOutfit(id: string) {
    await wardrobeDb.deleteOutfit(id);
    setOutfits((current) => current.filter((outfit) => outfit.id !== id));
    showNotice("搭配已删除。");
  }

  function exportBackup() {
    const payload: BackupPayload = {
      app: "衣搭",
      version: 1,
      exportedAt: new Date().toISOString(),
      items,
      outfits,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `衣搭备份-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as BackupPayload;
      if (payload.app !== "衣搭" || payload.version !== 1 || !Array.isArray(payload.items)) {
        throw new Error("Invalid backup");
      }
      await wardrobeDb.replaceAll(payload.items, payload.outfits ?? []);
      setItems(payload.items.sort((a, b) => b.createdAt - a.createdAt));
      setOutfits((payload.outfits ?? []).sort((a, b) => b.createdAt - a.createdAt));
      setCanvasPieces([]);
      showNotice("备份已导入。");
    } catch {
      showNotice("备份文件无法识别。");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>衣搭</h1>
            <p>Wardrobe studio</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-button" onClick={exportBackup} aria-label="导出备份">
            ↓
          </button>
          <button className="icon-button" onClick={() => importInputRef.current?.click()} aria-label="导入备份">
            ↑
          </button>
          <input ref={importInputRef} className="hidden-input" type="file" accept="application/json" onChange={importBackup} />
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <main>
        {activeTab === "搭配" && (
          <section className="view outfit-view">
            <CategoryFilter value={selectedCategory} onChange={setSelectedCategory} />
            <ItemGrid items={filteredItems} emptyText="先到衣柜添加衣物，再回来搭配。" onPick={addItemToCanvas} onDragStart={handleDragStart} />

            <div
              ref={canvasRef}
              className={`free-canvas ${canvasItems.length ? "has-items" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleCanvasDrop}
              aria-label="自由画布"
            >
              <button className="primary-button canvas-save-button" disabled={!canSaveOutfit || isSaving} onClick={saveCurrentOutfit}>
                保存搭配
              </button>
              {canvasItems.map((piece) => (
                <div
                  key={piece.id}
                  className={`canvas-piece ${movingPieceId === piece.id ? "moving" : ""}`}
                  style={{ left: piece.x, top: piece.y }}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setMovingPieceId(piece.id);
                  }}
                  onPointerMove={(event) => movePiece(piece.id, event)}
                  onPointerUp={(event) => {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    setMovingPieceId(null);
                  }}
                >
                  <img src={piece.item.imageDataUrl} alt={piece.item.name} draggable={false} />
                  <button aria-label={`移除${piece.item.name}`} onClick={() => removePiece(piece.id)}>×</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "衣柜" && (
          <section className="view wardrobe-view">
            <div className="section-heading">
              <div>
                <p className="eyebrow">01 / Wardrobe</p>
                <h2>新增衣物</h2>
              </div>
            </div>

            <form className="item-form" onSubmit={handleAddItem}>
              <div className="photo-picker">
                {draft.imageDataUrl ? (
                  <img src={draft.imageDataUrl} alt="衣物预览" />
                ) : (
                  <div className="photo-split">
                    <label className="photo-choice photo-choice-camera">
                      <span>{isCuttingOut ? "正在抠图" : "拍照"}</span>
                      <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} disabled={isCuttingOut} />
                    </label>
                    <label className="photo-choice photo-choice-upload">
                      <span>上传</span>
                      <input type="file" accept="image/*" onChange={handleImageChange} disabled={isCuttingOut} />
                    </label>
                  </div>
                )}
                {isCuttingOut && <em>自动去除背景中</em>}
              </div>

              {draft.imageDataUrl && (
              <div className="photo-actions">
                <label className="upload-button">
                  重新拍照
                  <input type="file" accept="image/*" capture="environment" onChange={handleImageChange} disabled={isCuttingOut} />
                </label>
                <label className="upload-button">
                  更换相册图
                  <input type="file" accept="image/*" onChange={handleImageChange} disabled={isCuttingOut} />
                </label>
              </div>
              )}

              <div className="photo-note">
                上传后会自动去除背景，衣服颜色保留原图。
              </div>

              <div className="form-grid">
                <label>
                  名称
                  <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如 白衬衫" />
                </label>
                <label>
                  分类
                  <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as Category }))}>
                    {categories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </label>
                <label>
                  颜色
                  <select value={draft.color} onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))}>
                    {colors.map((color) => <option key={color}>{color}</option>)}
                  </select>
                </label>
                <label>
                  季节
                  <select value={draft.season} onChange={(event) => setDraft((current) => ({ ...current, season: event.target.value as Season }))}>
                    {seasons.map((season) => <option key={season}>{season}</option>)}
                  </select>
                </label>
              </div>
              <button className="primary-button wide" type="submit" disabled={isCuttingOut}>加入衣柜</button>
            </form>

            <CategoryFilter value={selectedCategory} onChange={setSelectedCategory} />
            <ItemGrid items={filteredItems} emptyText="还没有衣物。添加第一件后会显示在这里。" onPick={addItemToCanvas} onDelete={handleDeleteItem} />
          </section>
        )}

        {activeTab === "收藏" && (
          <section className="view">
            <div className="section-heading">
              <div>
                <p className="eyebrow">02 / Collection</p>
                <h2>收藏搭配</h2>
              </div>
            </div>
            <div className="outfit-list">
              {outfits.length === 0 ? (
                <EmptyState title="暂无收藏" text="在搭配页组合衣物后，点保存搭配。" />
              ) : (
                outfits.map((outfit) => (
                  <OutfitCard key={outfit.id} outfit={outfit} items={items} onDelete={deleteOutfit} />
                ))
              )}
            </div>
          </section>
        )}
      </main>

      <nav className="bottom-tabs" aria-label="主导航">
        {(["搭配", "衣柜", "收藏"] as Tab[]).map((tab) => (
          <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </nav>
    </div>
  );
}

function CategoryFilter({ value, onChange }: { value: Category | "全部"; onChange: (value: Category | "全部") => void }) {
  return (
    <div className="segmented" aria-label="衣物分类筛选">
      {(["全部", ...categories] as Array<Category | "全部">).map((category) => (
        <button key={category} className={value === category ? "active" : ""} onClick={() => onChange(category)}>
          {category}
        </button>
      ))}
    </div>
  );
}

function ItemGrid({
  items,
  emptyText,
  onPick,
  onDelete,
  onDragStart,
}: {
  items: WardrobeItem[];
  emptyText: string;
  onPick: (item: WardrobeItem) => void;
  onDelete?: (id: string) => void;
  onDragStart?: (item: WardrobeItem, event: React.DragEvent<HTMLButtonElement>) => void;
}) {
  if (items.length === 0) {
    return <EmptyState title="空空的" text={emptyText} />;
  }

  return (
    <div className="item-grid">
      {items.map((item) => (
        <article className="item-card" key={item.id}>
          <button className="item-image-button" draggable={Boolean(onDragStart)} onDragStart={(event) => onDragStart?.(item, event)} onClick={() => onPick(item)}>
            <img src={item.imageDataUrl} alt={item.name} draggable={false} />
          </button>
          <div className="item-meta">
            <strong>{item.name}</strong>
            <span>{item.category} · {item.color} · {item.season}</span>
          </div>
          {onDelete && (
            <button className="text-button" onClick={() => onDelete(item.id)}>
              删除
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

function OutfitCard({ outfit, items, onDelete }: { outfit: Outfit; items: WardrobeItem[]; onDelete: (id: string) => void }) {
  const outfitPieces = outfit.pieces ?? [];
  const selectedItems = outfitPieces
    .map((piece) => items.find((item) => item.id === piece.itemId))
    .filter((item): item is WardrobeItem => Boolean(item));

  return (
    <article className="outfit-card">
      <div className="outfit-card-header">
        <div>
          <strong>{outfit.name}</strong>
          <span>{new Date(outfit.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <button className="text-button" onClick={() => onDelete(outfit.id)}>删除</button>
      </div>
      <div className="outfit-thumbs">
        {selectedItems.map((item) => (
          <img key={item.id} src={item.imageDataUrl} alt={item.name} draggable={false} />
        ))}
      </div>
    </article>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

async function createGarmentCutoutDataUrl(file: File): Promise<string> {
  const cutoutBlob = await removeBackground(file, removeBackgroundConfig);
  return refineCutoutDataUrl(cutoutBlob);
}

async function refineCutoutDataUrl(blob: Blob): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(blob);
  const image = await loadImage(rawDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return rawDataUrl;

  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const cropBox = keepLargestGarmentMask(imageData);
  if (!cropBox) return rawDataUrl;

  context.putImageData(imageData, 0, 0);

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropBox.width;
  cropCanvas.height = cropBox.height;

  const cropContext = cropCanvas.getContext("2d");
  if (!cropContext) return canvas.toDataURL("image/png");

  cropContext.drawImage(
    canvas,
    cropBox.x,
    cropBox.y,
    cropBox.width,
    cropBox.height,
    0,
    0,
    cropBox.width,
    cropBox.height,
  );

  return cropCanvas.toDataURL("image/png");
}

function keepLargestGarmentMask(imageData: ImageData) {
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  const foreground = new Uint8Array(pixelCount);
  const labels = new Int32Array(pixelCount);
  const stack = new Int32Array(pixelCount);
  const alphaThreshold = 58;
  const strongAlphaThreshold = 126;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    foreground[pixel] = data[pixel * 4 + 3] > alphaThreshold ? 1 : 0;
  }

  let label = 0;
  let largestLabel = 0;
  let largestCount = 0;

  for (let start = 0; start < pixelCount; start += 1) {
    if (!foreground[start] || labels[start]) continue;

    label += 1;
    let count = 0;
    let stackSize = 1;
    stack[0] = start;
    labels[start] = label;

    while (stackSize > 0) {
      const current = stack[--stackSize];
      count += 1;
      const x = current % width;

      if (x > 0) stackSize = pushForegroundNeighbor(current - 1, label, foreground, labels, stack, stackSize);
      if (x < width - 1) stackSize = pushForegroundNeighbor(current + 1, label, foreground, labels, stack, stackSize);
      if (current >= width) stackSize = pushForegroundNeighbor(current - width, label, foreground, labels, stack, stackSize);
      if (current < pixelCount - width) stackSize = pushForegroundNeighbor(current + width, label, foreground, labels, stack, stackSize);
    }

    if (count > largestCount) {
      largestCount = count;
      largestLabel = label;
    }
  }

  if (!largestLabel) return null;

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let luminanceTotal = 0;
  let luminanceCount = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const alphaIndex = pixel * 4 + 3;
    const alpha = data[alphaIndex];
    if (labels[pixel] !== largestLabel || alpha <= alphaThreshold) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    if (alpha >= strongAlphaThreshold) {
      const colorIndex = pixel * 4;
      luminanceTotal += getLuminance(data[colorIndex], data[colorIndex + 1], data[colorIndex + 2]);
      luminanceCount += 1;
    }
  }

  const averageLuminance = luminanceCount ? luminanceTotal / luminanceCount : 255;
  const isDarkGarment = averageLuminance < 115;
  const garmentHeight = Math.max(1, maxY - minY + 1);
  const garmentTop = minY;
  const columnHemline = isDarkGarment ? getDarkGarmentHemline(labels, largestLabel, data, width, height, alphaThreshold) : null;
  minX = width;
  minY = height;
  maxX = 0;
  maxY = 0;

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const colorIndex = pixel * 4;
    const alphaIndex = colorIndex + 3;
    const alpha = data[alphaIndex];

    if (labels[pixel] !== largestLabel || alpha <= alphaThreshold) {
      data[alphaIndex] = 0;
      continue;
    }

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const luminance = getLuminance(data[colorIndex], data[colorIndex + 1], data[colorIndex + 2]);
    const saturation = getSaturation(data[colorIndex], data[colorIndex + 1], data[colorIndex + 2]);
    const lowerHalf = y > garmentTop + garmentHeight * 0.48;
    const likelyLightBackground = isDarkGarment && lowerHalf && luminance > 112 && saturation < 0.42;
    const belowDetectedHem = columnHemline ? y > columnHemline[x] + 3 : false;

    if (belowDetectedHem || likelyLightBackground) {
      data[alphaIndex] = 0;
    } else if (alpha >= strongAlphaThreshold) {
      data[alphaIndex] = 255;
    } else {
      data[alphaIndex] = Math.round(((alpha - alphaThreshold) / (strongAlphaThreshold - alphaThreshold)) * 255);
    }

    if (data[alphaIndex] === 0) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (minX > maxX || minY > maxY) return null;

  const padding = Math.max(8, Math.round(Math.max(width, height) * 0.012));
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const right = Math.min(width - 1, maxX + padding);
  const bottom = Math.min(height - 1, maxY + padding);

  return {
    x,
    y,
    width: right - x + 1,
    height: bottom - y + 1,
  };
}

function pushForegroundNeighbor(
  pixel: number,
  label: number,
  foreground: Uint8Array,
  labels: Int32Array,
  stack: Int32Array,
  stackSize: number,
) {
  if (foreground[pixel] && !labels[pixel]) {
    labels[pixel] = label;
    stack[stackSize] = pixel;
    return stackSize + 1;
  }

  return stackSize;
}

function getDarkGarmentHemline(
  labels: Int32Array,
  garmentLabel: number,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number,
) {
  const rawHemline = new Int32Array(width);
  rawHemline.fill(-1);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (labels[pixel] !== garmentLabel) continue;

    const colorIndex = pixel * 4;
    const alpha = data[colorIndex + 3];
    if (alpha <= alphaThreshold) continue;

    const luminance = getLuminance(data[colorIndex], data[colorIndex + 1], data[colorIndex + 2]);
    const saturation = getSaturation(data[colorIndex], data[colorIndex + 1], data[colorIndex + 2]);
    const isDarkFabric = luminance < 92;
    const isGreenPrint = data[colorIndex + 1] > data[colorIndex] * 1.12 && data[colorIndex + 1] > data[colorIndex + 2] * 1.08 && saturation > 0.18;

    if (!isDarkFabric && !isGreenPrint) continue;

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    rawHemline[x] = Math.max(rawHemline[x], y);
  }

  const smoothedHemline = new Int32Array(width);
  const radius = Math.max(8, Math.round(width * 0.018));

  for (let x = 0; x < width; x += 1) {
    let maxY = -1;
    const left = Math.max(0, x - radius);
    const right = Math.min(width - 1, x + radius);

    for (let sampleX = left; sampleX <= right; sampleX += 1) {
      maxY = Math.max(maxY, rawHemline[sampleX]);
    }

    smoothedHemline[x] = maxY;
  }

  return smoothedHemline;
}

function getLuminance(red: number, green: number, blue: number) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function getSaturation(red: number, green: number, blue: number) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return max === 0 ? 0 : (max - min) / max;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = src;
  });
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function clampCanvasPosition(x: number, y: number, rect: DOMRect) {
  return {
    x: Math.max(0, Math.min(x, rect.width - canvasPieceSize)),
    y: Math.max(0, Math.min(y, rect.height - canvasPieceSize)),
  };
}

export default App;
