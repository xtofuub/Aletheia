import {
  DatabaseIcon,
  HardDriveIcon,
  SettingsIcon,
  WifiOffIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function NavUser() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        nativeButton={false}
        render={<Avatar className="size-8" />}
      >
        <AvatarFallback>AL</AvatarFallback>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-3">
          <Avatar className="size-9">
            <AvatarFallback>AL</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">Aletheia</p>
            <p className="truncate text-xs text-muted-foreground">
              Local investigation engine
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<a href="#/datasets" />}>
            <DatabaseIcon />
            Datasets
          </DropdownMenuItem>
          <DropdownMenuItem render={<a href="#/settings" />}>
            <SettingsIcon />
            Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled>
            <HardDriveIcon />
            Data stays on this device
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <WifiOffIcon />
            Network boundary active
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
