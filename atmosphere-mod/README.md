# 区域氛围模组

适用于 Fabric 1.21.11，Java 21。默认禁用，未绑定任何真实玩家存档。修改 config/anor-londo-atmosphere.json 的 enabled、saveFolder、minX/maxX/minZ/maxZ 后使用 /anorlondo reload。

区域内支持金色天空、雾、调色与三首用户本机音乐；区域外恢复原版。音乐不包含在发布包中。import-music.ps1 支持 -AudioFile、-CombatFile、-DarkFile、-GameDirectory；MP3 等格式需 FFmpeg。

构建需 Java 21、精确版本的 named Minecraft JAR、Yarn mappings.tiny、Tiny Remapper，以及已 remap 的 Fabric API，放在 -DependencyDirectory 指定目录（含 named-classpath.txt）。build.ps1 输出 dist。
