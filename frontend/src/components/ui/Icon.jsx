import {
  Activity, SlidersHorizontal, CircleAlert, TriangleAlert, Armchair, ArrowDown,
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, ArrowLeftRight,
  Merge, Split, Bell, CircleDot, Lightbulb, Calendar, CalendarCheck, CalendarPlus,
  CalendarX, Banknote, ChartColumn, ChartScatter, Check, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, Circle, CircleCheck, ClipboardCheck, ClipboardList,
  Clock, ClockAlert, Command, CreditCard, Save, Download, Flag, History, Info,
  KeyRound, PanelsTopLeft, LayoutDashboard, LayoutGrid, List, Droplets, ListChecks,
  LoaderCircle, Lock, ShieldCheck, LogOut, Menu, Minus, Moon, StickyNote, Package,
  PackageX, PackagePlus, Pencil, Pause, Play, Plus, Printer, QrCode, Receipt,
  ReceiptText, RefreshCw, Search, ChevronsUpDown, Settings, Shield, ShoppingBag,
  ShoppingCart, Cigarette, Snowflake, Sun, Wrench, Trash2, Trophy, User,
  UserCheck, CircleUser, UserRound, UserPlus, Users, UsersRound, WifiOff, X,
} from "lucide-react";

// Legacy semantic names stay stable while every glyph comes from Lucide.
const icons = {
  activity: Activity, adjustments: SlidersHorizontal, "alert-circle": CircleAlert,
  "alert-circle-filled": CircleAlert, "alert-triangle": TriangleAlert, armchair: Armchair,
  "arrow-down": ArrowDown, "arrow-down-right": ArrowDownRight, "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight, "arrow-up": ArrowUp, "arrow-up-right": ArrowUpRight,
  "arrows-exchange": ArrowLeftRight, "arrows-join": Merge, "arrows-split": Split,
  bell: Bell, billiard: CircleDot, bulb: Lightbulb, calendar: Calendar,
  "calendar-check": CalendarCheck, "calendar-event": Calendar, "calendar-plus": CalendarPlus,
  "calendar-x": CalendarX, cash: Banknote, "chart-bar": ChartColumn, "chart-dots": ChartScatter,
  check: Check, "chevron-down": ChevronDown, "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight, "chevron-up": ChevronUp, circle: Circle,
  "circle-check": CircleCheck, "circle-check-filled": CircleCheck, "circle-dot": CircleDot,
  "circle-dotted": Circle, "clipboard-check": ClipboardCheck, "clipboard-text": ClipboardList,
  clock: Clock, "clock-exclamation": ClockAlert, "clock-hour-4": Clock, command: Command,
  "credit-card": CreditCard, "device-floppy": Save, download: Download, flag: Flag,
  history: History, "info-circle": Info, "info-circle-filled": Info, key: KeyRound,
  "layout-board": PanelsTopLeft, "layout-dashboard": LayoutDashboard, "layout-grid": LayoutGrid,
  "layout-list": List, leakage: Droplets, "list-check": ListChecks, "loader-2": LoaderCircle,
  lock: Lock, "lock-check": ShieldCheck, logout: LogOut, "menu-2": Menu, minus: Minus,
  moon: Moon, note: StickyNote, package: Package, "package-off": PackageX,
  "package-plus": PackagePlus, pencil: Pencil, "player-pause": Pause, "player-play": Play,
  plus: Plus, printer: Printer, qrcode: QrCode, receipt: Receipt, "receipt-refund": ReceiptText,
  refresh: RefreshCw, "report-money": ReceiptText, search: Search, selector: ChevronsUpDown,
  settings: Settings, "shield-check": ShieldCheck, "shield-lock": Shield, "shopping-bag": ShoppingBag,
  "shopping-cart-plus": ShoppingCart, smoking: Cigarette, snowflake: Snowflake, sun: Sun,
  "table-off": PanelsTopLeft, tool: Wrench, "tool-off": Wrench, "tools-kitchen-2": ShoppingBag,
  trash: Trash2, trophy: Trophy, user: User, "user-check": UserCheck, "user-circle": CircleUser,
  "user-clock": UserRound, "user-plus": UserPlus, users: Users, "users-plus": UsersRound,
  "wifi-off": WifiOff, x: X,
};

export default function Icon({ name, className = "", size = 16, ...props }) {
  const key = name?.replace(/^ti-/, "") || className.match(/\bti-([\w-]+)/)?.[1];
  const Glyph = icons[key] || Circle;
  return <i className={`${className} ui-icon`} aria-hidden="true" {...props}><Glyph size={size} strokeWidth={1.5} aria-hidden="true" /></i>;
}
