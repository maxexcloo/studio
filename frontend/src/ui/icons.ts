import {
  Blend,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  CirclePlay,
  CircleStop,
  ClipboardPaste,
  Columns2,
  ContactRound,
  Copy,
  CopyPlus,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  Files,
  GalleryHorizontalEnd,
  Heart,
  ImageUp,
  ImageUpscale,
  Info,
  LayoutDashboard,
  Layers,
  Lightbulb,
  ListFilter,
  ListX,
  MapPinned,
  Maximize2,
  MessageCircle,
  Moon,
  Pencil,
  PenLine,
  Play,
  Plus,
  Puzzle,
  Redo2,
  RefreshCw,
  Repeat2,
  RotateCcw,
  RotateCw,
  Rows2,
  ScanSearch,
  ScanText,
  ScrollText,
  Settings,
  Share,
  Shirt,
  SlidersHorizontal,
  Sparkles,
  Star,
  TextCursorInput,
  Trash2,
  Trophy,
  Undo2,
  Upload,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";

/** One icon per meaning: every action, mode and recurring control takes its icon from here. */
export const icons = {
  /** Making a new record, such as New Character. */
  add: Plus,
  animate: Play,
  /** The prompt assistant and its ideas. */
  assistant: Sparkles,
  /** Character cards: their tab, section and Use as Character. */
  character: ContactRound,
  /** The chat site (LibreChat) the navigation links to. */
  chat: MessageCircle,
  clear: X,
  /** Clear Failed: failed generations leave the queue. */
  clearFailed: ListX,
  /** Comparing variants: Compare runs and the composer's Compare. */
  compare: Blend,
  /** Two versions side by side (Compare Upscale). */
  compareSideBySide: Columns2,
  /** Two versions one above the other (Compare Upscale on phones). */
  compareStacked: Rows2,
  copy: Copy,
  /** Custom…: asking in one's own words, such as Custom Animation. */
  custom: PenLine,
  delete: Trash2,
  details: Info,
  download: Download,
  dream: Moon,
  /** Duplicating a record into a new one, such as Duplicate Profile…. */
  duplicate: Files,
  edit: Pencil,
  /** A link that opens another site in a new tab. */
  external: ExternalLink,
  filter: ListFilter,
  /** Hiding a revealed secret again, such as the MCP token. */
  hide: EyeOff,
  keep: Heart,
  /** A record's timestamped lines: a runtime change's steps or a workload's log. */
  log: ScrollText,
  loras: Puzzle,
  more: Ellipsis,
  /** Asking Dream for more in an item's direction (More Like This). */
  moreLikeThis: CopyPlus,
  /** Moving to the next item: the viewer's, a preview's and a comparison's arrows. */
  next: ChevronRight,
  /** Opening every result of a run in the viewer. */
  openAll: GalleryHorizontalEnd,
  /** An outfit card (Library › Outfits). */
  outfit: Shirt,
  paste: ClipboardPaste,
  /** Holding and releasing work: the queue and Dream. */
  pause: CirclePause,
  /** A saved preset: the Presets chip and Library › Presets. */
  preset: Bookmark,
  /** Seeing a choice full screen before choosing it. */
  preview: Maximize2,
  /** Moving to the previous item, as `next`. */
  previous: ChevronLeft,
  /** Editing a prompt and the composer's settings. */
  prompt: SlidersHorizontal,
  /** Running an item again (Recreate). */
  recreate: Repeat2,
  redo: Redo2,
  /** Asking again: checking for updates, refreshing status and suggestions. */
  refresh: RefreshCw,
  rename: TextCursorInput,
  /** Returning a text to where it started, such as the viewer's prompt. */
  reset: RotateCcw,
  resume: CirclePlay,
  retry: RotateCw,
  /** Showing a written prompt for editing before it runs (Review Prompt). */
  review: ScanText,
  /** A scene card (Library › Scenes). */
  scene: MapPinned,
  settings: Settings,
  share: Share,
  /** A character's design sheet (Make Sheet). */
  sheet: LayoutDashboard,
  /** Revealing a hidden secret, such as the MCP token. */
  show: Eye,
  /** Similar: the gallery ranked by likeness to an image. */
  similar: ScanSearch,
  star: Star,
  /** Stopping work: a stop sign rather than a bare square, which reads as a checkbox. */
  stop: CircleStop,
  /** Short changes offered for an image or draft. */
  suggestions: Lightbulb,
  undo: Undo2,
  upload: Upload,
  /** The uploaded images: the gallery's Uploads toggle, apart from the Upload action. */
  uploads: ImageUp,
  upscale: ImageUpscale,
  /** Running an item again from its prompt with new seeds (Dream's Variations). */
  variations: WandSparkles,
  versions: Layers,
  winner: Trophy,
} satisfies Record<string, LucideIcon>;
