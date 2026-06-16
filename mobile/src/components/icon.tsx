import {
  Activity,
  AlertCircle,
  ArrowUp,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Code,
  Cpu,
  FileText,
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
  Paperclip,
  Plus,
  QrCode,
  Search,
  Server,
  Settings,
  Terminal,
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
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  circle: Circle,
  clock: Clock,
  code: Code,
  cpu: Cpu,
  'file-text': FileText,
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
  paperclip: Paperclip,
  plus: Plus,
  'qr-code': QrCode,
  search: Search,
  server: Server,
  settings: Settings,
  terminal: Terminal,
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
