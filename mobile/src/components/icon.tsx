import {
  Activity,
  AlertCircle,
  ArrowUp,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Code,
  Cpu,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  LoaderCircle,
  Lock,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  Paperclip,
  Plus,
  QrCode,
  Search,
  Server,
  Settings,
  Sun,
  Terminal,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react-native';

/** Maps app icon names to Lucide components — the same icon set the web uses. */
const ICONS = {
  activity: Activity,
  'alert-circle': AlertCircle,
  'arrow-up': ArrowUp,
  bell: Bell,
  check: Check,
  'check-circle': CheckCircle2,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  circle: Circle,
  clock: Clock,
  code: Code,
  cpu: Cpu,
  'file-text': FileText,
  folder: Folder,
  'folder-open': FolderOpen,
  'git-branch': GitBranch,
  'git-merge': GitMerge,
  'git-pull-request': GitPullRequest,
  globe: Globe,
  grid: LayoutGrid,
  image: ImageIcon,
  loader: LoaderCircle,
  lock: Lock,
  'log-out': LogOut,
  mail: Mail,
  menu: Menu,
  'message-square': MessageSquare,
  monitor: Monitor,
  moon: Moon,
  paperclip: Paperclip,
  plus: Plus,
  'qr-code': QrCode,
  search: Search,
  server: Server,
  settings: Settings,
  sun: Sun,
  terminal: Terminal,
  trash: Trash2,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export default function Icon({ name, size = 18, color = '#000', strokeWidth = 2 }: Props) {
  const Cmp = ICONS[name];
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} />;
}
