import {
  Activity,
  ArrowDownUp,
  ArrowLeftRight,
  Ban,
  Blend,
  BookOpen,
  Bookmark,
  Boxes,
  Brush,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleMinus,
  ClipboardPaste,
  Columns2,
  ContactRound,
  Copy,
  CopyCheck,
  CopyPlus,
  CopyX,
  Dices,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FastForward,
  FileCog,
  Files,
  Fingerprint,
  Flag,
  Flame,
  FolderOpen,
  FolderUp,
  GalleryHorizontalEnd,
  Gauge,
  Heart,
  History,
  Image,
  ImageDown,
  ImageOff,
  ImagePlus,
  ImageUp,
  ImageUpscale,
  Import,
  Info,
  KeyRound,
  Layers,
  LayoutDashboard,
  Library,
  Link,
  List,
  ListChecks,
  ListFilter,
  ListRestart,
  ListX,
  LogOut,
  type LucideIcon,
  MapPinned,
  Maximize2,
  MessageCircle,
  Minus,
  Moon,
  Palette,
  PanelsTopLeft,
  Pause,
  PenLine,
  Pencil,
  Pin,
  Play,
  Plug,
  Plus,
  Puzzle,
  Redo2,
  RefreshCw,
  Repeat,
  Repeat2,
  Replace,
  Rewind,
  RotateCcw,
  RotateCw,
  Route,
  Rows2,
  ScanFace,
  ScanSearch,
  ScanText,
  ScrollText,
  Server,
  Settings,
  Share,
  Shield,
  ShieldCheck,
  ShieldUser,
  Shirt,
  Shuffle,
  SlidersHorizontal,
  SlidersVertical,
  Snail,
  SpellCheck,
  Square,
  SquareCheck,
  SwatchBook,
  TextCursorInput,
  TextQuote,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Trophy,
  Undo2,
  Unlink,
  Upload,
  UserCheck,
  UserRound,
  UserX,
  UsersRound,
  Video,
  Volume2,
  VolumeX,
  WandSparkles,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { createElement, forwardRef } from "react";

const filled = (Icon: LucideIcon): LucideIcon =>
  forwardRef((props, ref) => createElement(Icon, { fill: "currentColor", ...props, ref }));

/** One icon per meaning: every action, mode and recurring control takes its icon from here. */
export const icons = {
  /** Accepting a proposal, such as an import's substitute model. */
  accept: Check,
  account: UserRound,
  /** Adding something: a new record, such as New Character, or a reference to an empty slot. */
  add: Plus,
  /** Making an account an administrator; Make User takes `account`. */
  administrator: ShieldUser,
  animate: Play,
  /** Appearance: the header's popover of colour scheme, background and motion. */
  appearance: Palette,
  /** Prompt assistance, including suggestions and templates. */
  assistant: WandSparkles,
  /** Playing a video forwards then backwards (Back & Forth). */
  backAndForth: ArrowLeftRight,
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
  /** Converting a profile to another backend, such as Convert to Radiance. */
  convert: Zap,
  copy: Copy,
  /** Copying an item's settings as text (Copy Details). */
  copyDetails: ListChecks,
  copyPrompt: TextQuote,
  /** Custom…: asking in one's own words, such as Custom Animation. */
  custom: PenLine,
  delete: Trash2,
  /** Deleting an account's whole gallery. */
  deleteGallery: ImageOff,
  details: Info,
  disableAccount: UserX,
  /** Disliking an item hides it from the gallery; again, in its Disliked view, restores it. */
  dislike: ThumbsDown,
  download: Download,
  dream: Moon,
  /** Duplicating a record into a new one, such as Duplicate Profile…. */
  duplicate: Files,
  edit: Pencil,
  enableAccount: UserCheck,
  /** Never: an Exclusion in Settings › Taste, never used anywhere. */
  exclude: Ban,
  /** A link that opens another site in a new tab. */
  external: ExternalLink,
  /** Continuing a video from its last frame. */
  extend: FastForward,
  /** Face Detail: refining faces as part of an upscale. */
  faceDetail: ScanFace,
  /** Shared model files: checkpoints, diffusion models, text encoders and VAEs. */
  files: Boxes,
  filter: ListFilter,
  /** An access group and the grants it holds. */
  group: Shield,
  /** A prompting guide (Library › Guides). */
  guide: BookOpen,
  /** Hiding a revealed secret again, such as the MCP token. */
  hide: EyeOff,
  /** Prompt History: the prompts an account sent before. */
  history: History,
  /** Image mode and image work, as against video. */
  image: Image,
  /** Bringing something in from elsewhere: Library › Imports and the gallery's Import ▾. */
  import: Import,
  /** Keeping something: Dream's Accept. */
  keep: CircleCheck,
  /** Keeping every side of a comparison: its Accept Both or All. */
  keepAll: CopyCheck,
  /** Less Of in Settings › Taste: a soft down-weight. */
  less: CircleMinus,
  library: Library,
  like: ThumbsUp,
  /** A pasted web link, such as Import › From URL. */
  link: Link,
  /** A record's timestamped lines: a runtime change's steps or a workload's log. */
  log: ScrollText,
  loras: Puzzle,
  /** Painting a mask over a reference. */
  mask: Brush,
  /** MCP clients and the work they send. */
  mcp: Plug,
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
  /** Passing every side of a comparison: its Pass Both or All. */
  passAll: CopyX,
  /** Setting or resetting a password. */
  password: KeyRound,
  paste: ClipboardPaste,
  /** Holding and releasing work: the queue and Dream. */
  pause: filled(Pause),
  /** Favourites in Settings › Taste. */
  pin: Pin,
  /** A saved preset: the Presets chip and Library › Presets. */
  preset: Bookmark,
  /** Seeing a choice full screen before choosing it. */
  preview: Maximize2,
  /** Moving to the previous item, as `next`. */
  previous: ChevronLeft,
  /** A generation profile and its workflow (Library › Profiles). */
  profile: FileCog,
  /** A Dream project: Dream › Projects and a proposal for a new one. */
  project: FolderOpen,
  /** Editing a prompt and the composer's settings. */
  prompt: SlidersHorizontal,
  /** The assistant's styles and templates (Library › Templates). */
  promptStyles: SwatchBook,
  queue: List,
  /** Running an item again (Recreate). */
  recreate: Repeat2,
  redo: Redo2,
  reference: ImagePlus,
  /** Asking again: checking for updates, refreshing status and suggestions. */
  refresh: RefreshCw,
  /** Rejecting a proposal, as against `accept`. */
  reject: X,
  rename: TextCursorInput,
  /** Putting another record in a record's place, such as a reference in its slot. */
  replace: Replace,
  /** Report Issue…: saying what is wrong with a result so Studio fixes it. */
  report: Flag,
  /** Returning a text to where it started, such as the viewer's prompt. */
  reset: RotateCcw,
  /** Starting or resuming work, beside Pause or Stop. */
  resume: filled(Play),
  retry: RotateCw,
  /** Playing a video backwards (Reverse). */
  reverse: Rewind,
  /** Showing a written prompt for editing before it runs (Review Prompt). */
  review: ScanText,
  /** Where work runs: the workers and providers an account's work goes to. */
  routing: Route,
  /** A rule an issue suggests, as Dream's Inbox proposes one. */
  rule: ShieldCheck,
  /** Running an item again with its own seed (Run Again, Same Seed). */
  sameSeed: Repeat,
  /** Saving a video's frame as an image. */
  saveFrame: ImageDown,
  /** A scene card (Library › Scenes). */
  scene: MapPinned,
  /** A random seed. */
  seed: Dices,
  select: SquareCheck,
  settings: Settings,
  share: Share,
  /** A character's design sheet (Make Sheet). */
  sheet: LayoutDashboard,
  /** Revealing something hidden: the MCP token, or the upscale in place of the original. */
  show: Eye,
  shuffle: Shuffle,
  signOut: LogOut,
  /** Image discovery and the gallery ranked by likeness to an image (Similar). */
  similar: ScanSearch,
  slowMotion: Snail,
  smoothMotion: Waves,
  sort: ArrowDownUp,
  sound: Volume2,
  stop: filled(Square),
  /** Studio-wide settings an administrator sets (Settings › Studio). */
  studio: SlidersVertical,
  /** Super Like: accepting a Dream result and rating it Liked. */
  superLike: Heart,
  /** Taste: what Studio learnt of an account's preferences, and their own. */
  taste: Fingerprint,
  templates: PanelsTopLeft,
  /** Explicit content: templates only accounts with Uncensored Models see. */
  uncensored: Flame,
  undo: Undo2,
  unfinished: ListRestart,
  /** Removing a link to another account, such as a chat gateway identity. */
  unlink: Unlink,
  upload: Upload,
  uploadFolder: FolderUp,
  /** The uploaded images: the gallery's Uploads toggle, apart from the Upload action. */
  uploads: ImageUp,
  upscale: ImageUpscale,
  /** Accounts as an administrator manages them (Settings › Users). */
  users: UsersRound,
  versions: Layers,
  /** Video mode and video work, as against image. */
  video: Video,
  winner: Trophy,
  /** GPU workers and services (Settings › Workers). */
  workers: Server,
  /** The writing rules every writer follows (Library › Writing Standard). */
  writing: SpellCheck,
  /** Zooming in, or larger gallery tiles. */
  zoomIn: Plus,
  /** Zooming out, or smaller gallery tiles. */
  zoomOut: Minus,
} satisfies Record<string, LucideIcon>;
