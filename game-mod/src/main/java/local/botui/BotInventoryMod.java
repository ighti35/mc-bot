package local.botui;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.command.argument.EntityArgumentType;
import net.minecraft.command.permission.Permission;
import net.minecraft.command.permission.PermissionLevel;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.screen.NamedScreenHandlerFactory;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.server.command.CommandManager;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.Text;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
public class BotInventoryMod implements ModInitializer {
    static final String PREFIX = "机器人管理 · ";
    static final Map<UUID, BotInventoryHandler> EDITORS = new HashMap<>();
    static boolean permitted(ServerCommandSource source) { return source.getPermissions().hasPermission(new Permission.Level(PermissionLevel.GAMEMASTERS)); }
    @Override public void onInitialize() {
        CommandRegistrationCallback.EVENT.register((dispatcher, registry, environment) -> {
            for (String name : new String[]{"botinv", "invsee"}) dispatcher.register(CommandManager.literal(name).requires(BotInventoryMod::permitted)
                .executes(context -> open(context.getSource(), context.getSource().getServer().getPlayerManager().getPlayer("Claude_Bot")))
                .then(CommandManager.argument("player", EntityArgumentType.player()).executes(context -> open(context.getSource(), EntityArgumentType.getPlayer(context, "player")))));
        });
    }
    static int open(ServerCommandSource source, ServerPlayerEntity target) {
        ServerPlayerEntity viewer = source.getPlayer();
        if (viewer == null || target == null || !target.isAlive()) { source.sendError(Text.literal("机器人未在线或已死亡。")); return 0; }
        if (viewer == target) { source.sendError(Text.literal("请选择机器人，而不是自己。")); return 0; }
        BotInventoryHandler old = EDITORS.get(target.getUuid());
        if (old != null && old.viewer.currentScreenHandler == old && old.canUse(old.viewer)) {
            if (old.viewer == viewer) viewer.closeHandledScreen();
            else { source.sendError(Text.literal("另一位玩家正在管理这个背包。")); return 0; }
        }
        viewer.openHandledScreen(new NamedScreenHandlerFactory() {
            @Override public Text getDisplayName() { return Text.literal(PREFIX + target.getName().getString()); }
            @Override public ScreenHandler createMenu(int syncId, PlayerInventory inventory, net.minecraft.entity.player.PlayerEntity player) {
                BotInventoryHandler handler = new BotInventoryHandler(syncId, viewer, target); EDITORS.put(target.getUuid(), handler); return handler;
            }
        }); return 1;
    }
}
