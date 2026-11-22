import {
  Activity,
  ArrowDownUp,
  Blend,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
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
  FastForward,
  Files,
  Flag,
  FolderOpen,
  GalleryHorizontalEnd,
  Gauge,
  ImagePlus,
  ImageUp,
  ImageUpscale,
  Import,
  Info,
  Layers,
  LayoutDashboard,
  Link,
  List,
  ListFilter,
  ListRestart,
  ListX,
  type LucideIcon,
  MapPinned,
  Maximize2,
  MessageCircle,
  Moon,
  Pause,
  PenLine,
  Pencil,
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
  ShieldCheck,
  Shirt,
  Shuffle,
  SlidersHorizontal,
  Square,
  SquareCheck,
  TextCursorInput,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Trophy,
  Undo2,
  Upload,
  UserRound,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
} from "lucide-react";
import { createElement, forwardRef } from "react";

const filled = (Icon: LucideIcon): LucideIcon =>
  forwardRef((props, ref) => createElement(Icon, { fill: "currentColor", ...props, ref }));

/** One icon per meaning: every action, mode and recurring control takes its icon from here. */
export const icons = {
  account: UserRound,
  /** Adding something: a new record, such as New Character, or a reference to an empty slot. */
  add: Plus,
  animate: Play,
  /** Prompt assistance, including suggestions and templates. */
  assistant: WandSparkles,
  /** Measuring a local text model's speed (Settings › Workers). */
  benchmark: Gauge,
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
  /** Disliking an item hides it from the gallery; again, in its Disliked view, restores it. */
  dislike: ThumbsDown,
  download: Download,
  dream: Moon,
  /** Duplicating a record into a new one, such as Duplicate Profile…. */
  duplicate: Files,
  edit: Pencil,
  /** A link that opens another site in a new tab. */
  external: ExternalLink,
  /** Continuing a video from its last frame. */
  extend: FastForward,
  filter: ListFilter,
  /** Hiding a revealed secret again, such as the MCP token. */
  hide: EyeOff,
  /** Bringing something in from elsewhere: Library › Imports and the gallery's Import ▾. */
  import: Import,
  /** Keeping something: Dream's Accept and a comparison's Both. */
  keep: CircleCheck,
  like: ThumbsUp,
  /** A pasted web link, such as Import › From URL. */
  link: Link,
  /** A record's timestamped lines: a runtime change's steps or a workload's log. */
  log: ScrollText,
  loras: Puzzle,
  more: Ellipsis,
  /** Variations following the direction of an item (More Like This). */
  moreLikeThis: CopyPlus,
  mute: VolumeX,
  /** Moving to the next item: the viewer's, a preview's and a comparison's arrows. */
  next: ChevronRight,
  /** Opening every result of a run in the viewer. */
  openAll: GalleryHorizontalEnd,
  /** An outfit card (Library › Outfits). */
  outfit: Shirt,
  /** A Dream project's pacing: its share of turns, pausing it or varying its results. */
  pacing: Activity,
  paste: ClipboardPaste,
  /** Holding and releasing work: the queue and Dream. */
  pause: filled(Pause),
  /** A saved preset: the Presets chip and Library › Presets. */
  preset: Bookmark,
  /** Seeing a choice full screen before choosing it. */
  preview: Maximize2,
  /** Moving to the previous item, as `next`. */
  previous: ChevronLeft,
  /** A Dream project: Dream › Projects and a proposal for a new one. */
  project: FolderOpen,
  /** Editing a prompt and the composer's settings. */
  prompt: SlidersHorizontal,
  queue: List,
  /** Running an item again (Recreate). */
  recreate: Repeat2,
  redo: Redo2,
  reference: ImagePlus,
  /** Asking again: checking for updates, refreshing status and suggestions. */
  refresh: RefreshCw,
  rename: TextCursorInput,
  /** Report Issue…: saying what is wrong with a result so Studio fixes it. */
  report: Flag,
  /** Returning a text to where it started, such as the viewer's prompt. */
  reset: RotateCcw,
  /** Starting or resuming work, beside Pause or Stop. */
  resume: filled(Play),
  retry: RotateCw,
  /** Showing a written prompt for editing before it runs (Review Prompt). */
  review: ScanText,
  /** A taste rule, a limit every prompt keeps, as Dream's Inbox proposes one. */
  rule: ShieldCheck,
  /** A scene card (Library › Scenes). */
  scene: MapPinned,
  select: SquareCheck,
  settings: Settings,
  share: Share,
  /** A character's design sheet (Make Sheet). */
  sheet: LayoutDashboard,
  /** Revealing a hidden secret, such as the MCP token. */
  show: Eye,
  shuffle: Shuffle,
  /** Image discovery and the gallery ranked by likeness to an image (Similar). */
  similar: ScanSearch,
  sort: ArrowDownUp,
  sound: Volume2,
  stop: filled(Square),
  undo: Undo2,
  unfinished: ListRestart,
  upload: Upload,
  /** The uploaded images: the gallery's Uploads toggle, apart from the Upload action. */
  uploads: ImageUp,
  upscale: ImageUpscale,
  versions: Layers,
  winner: Trophy,
} satisfies Record<string, LucideIcon>;
