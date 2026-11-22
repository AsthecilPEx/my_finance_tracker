import { motion } from 'motion/react';
import {
  AppWindow, ArrowDown, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpDown, Baby, Banknote, Bell, BookOpen, Bot, Briefcase, Bug, Building2,
  CalendarDays, CalendarRange, Camera, Car, ChartNoAxesColumn, Check, ChevronDown, ChevronRight, Circle, CircleAlert,
  CircleCheck, CircleDot, CircleHelp, Clapperboard, Coffee, Coins, Contrast, Copy, CreditCard, Dog, Droplet, Dumbbell,
  ExternalLink, FileText, FolderOpen, Gamepad2, Gauge, Gift, Globe, Handshake, HardDrive, Heart, Hourglass, House, Inbox,
  Info, Landmark, LayoutDashboard, Layers, LifeBuoy, Lightbulb, Loader2, Lock, MessageCircle, Monitor, Music, Package,
  PartyPopper, Pencil, PiggyBank, Pill, Plane, Receipt, RefreshCw, Repeat, Rocket, Scale, Scissors, Search, Settings,
  Share2, Shield, Shirt, ShoppingBag, ShoppingBasket, ShoppingCart, Smartphone, Sparkles, Star, Tag, Target, Ticket,
  TrainFront, Trash2, TrendingDown, TrendingUp, TriangleAlert, Tv, Umbrella, User, Utensils, Wallet, Wrench, X, Zap,
} from 'lucide-react';
import { iconName } from '../../engine/icons.js';

// Every icon the app uses, by name. Names come from code and from saved data (categories, goals),
// so they're looked up here rather than imported ad hoc. tests/icons.test.js checks each name used exists.
export const ICONS = {
  AppWindow, ArrowDown, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpDown, Baby, Banknote, Bell, BookOpen, Bot, Briefcase, Bug, Building2,
  CalendarDays, CalendarRange, Camera, Car, ChartNoAxesColumn, Check, ChevronDown, ChevronRight, Circle, CircleAlert,
  CircleCheck, CircleDot, CircleHelp, Clapperboard, Coffee, Coins, Contrast, Copy, CreditCard, Dog, Droplet, Dumbbell,
  ExternalLink, FileText, FolderOpen, Gamepad2, Gauge, Gift, Globe, Handshake, HardDrive, Heart, Hourglass, House, Inbox,
  Info, Landmark, LayoutDashboard, Layers, LifeBuoy, Lightbulb, Loader2, Lock, MessageCircle, Monitor, Music, Package,
  PartyPopper, Pencil, PiggyBank, Pill, Plane, Receipt, RefreshCw, Repeat, Rocket, Scale, Scissors, Search, Settings,
  Share2, Shield, Shirt, ShoppingBag, ShoppingBasket, ShoppingCart, Smartphone, Sparkles, Star, Tag, Target, Ticket,
  TrainFront, Trash2, TrendingDown, TrendingUp, TriangleAlert, Tv, Umbrella, User, Utensils, Wallet, Wrench, X, Zap,
};

// CLAUDE.md sizes: w-4 h-4 in buttons and text, w-5 h-5 in navigation, w-8 h-8 in empty states.
const SIZES = { sm: 'w-4 h-4', nav: 'w-5 h-5', lg: 'w-8 h-8' };

/** A lucide icon by name (or an old saved emoji, translated). Decorative unless given a label. */
export function Icon({ name, size = 'sm', className = '', label, fallback = 'Tag', ...rest }) {
  const Cmp = ICONS[iconName(name, fallback)] || ICONS[fallback] || Tag;
  return (
    <Cmp
      className={`icon ${SIZES[size] || SIZES.sm} ${className}`.trim()}
      strokeWidth={1.75}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
      {...rest}
    />
  );
}

/** Standard loading spinner. */
export function Spinner({ size = 'sm', className = '' }) {
  return <Loader2 className={`icon ${SIZES[size] || SIZES.sm} animate-spin ${className}`.trim()} strokeWidth={1.75} aria-hidden />;
}

/** An icon that pops in once: for success states and the attention bell. */
export function PopIcon({ name, size = 'sm', className = '', ...rest }) {
  return (
    <motion.span
      className="icon-pop"
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 18 }}
    >
      <Icon name={name} size={size} className={className} {...rest} />
    </motion.span>
  );
}

/** A small status dot for badges ("Live", "Connected"). Not an icon, so plain CSS. */
export function Dot() {
  return <span className="status-dot" aria-hidden />;
}
