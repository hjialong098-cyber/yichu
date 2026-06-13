export type Category = "上衣" | "下装" | "外套" | "鞋子" | "配饰";
export type Season = "春秋" | "夏季" | "冬季" | "四季";

export type WardrobeItem = {
  id: string;
  name: string;
  category: Category;
  color: string;
  season: Season;
  imageDataUrl: string;
  createdAt: number;
};

export type OutfitPiece = {
  id: string;
  itemId: string;
  x: number;
  y: number;
};

export type Outfit = {
  id: string;
  name: string;
  pieces: OutfitPiece[];
  createdAt: number;
};

export type BackupPayload = {
  app: "衣搭";
  version: 1;
  exportedAt: string;
  items: WardrobeItem[];
  outfits: Outfit[];
};
