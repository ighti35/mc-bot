package local.botui;
import com.google.gson.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.text.Text;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

public class BotBuildScreen extends Screen {
    private static final String BASE="http://127.0.0.1:52592";
    private static final HttpClient HTTP=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private JsonArray items=new JsonArray();
    private JsonObject status=new JsonObject(),selected;
    private String token="",message="正在连接 Claude-bot…",category="全部";
    private boolean started=false,polling=false,sending=false,clearTerrain=false,allowCommands=false,previewLoading=false;
    private long nextPoll=0;
    private int page=0,px,py,pw,ph,leftWidth,rows;
    private String sx="0",sy="64",sz="0",size="5";
    private TextFieldWidget xField,yField,zField,sizeField;
    private ButtonWidget buildButton,resumeButton,stopButton;
    public BotBuildScreen(){super(Text.literal("Claude-bot · 建筑图纸"));var p=MinecraftClient.getInstance().player;if(p!=null){sx=""+p.getBlockX();sy=""+p.getBlockY();sz=""+p.getBlockZ();}}
    private String viewer(){return client!=null&&client.player!=null?client.player.getName().getString():"";}
    private static String str(JsonObject o,String k,String fallback){try{return o.get(k).getAsString();}catch(RuntimeException e){return fallback;}}
    private static int num(JsonObject o,String k,int fallback){try{return o.get(k).getAsInt();}catch(RuntimeException e){return fallback;}}
    private static boolean bool(JsonObject o,String k){try{return o.get(k).getAsBoolean();}catch(RuntimeException e){return false;}}
    private CompletableFuture<JsonObject> request(String path,JsonObject body){
        var builder=HttpRequest.newBuilder(URI.create(BASE+path)).timeout(Duration.ofSeconds(25)).header("X-Bot-Game-Client","building-menu").header("X-Bot-Viewer",viewer());
        if(body!=null)builder.header("Content-Type","application/json").header("X-Panel-Token",token).POST(HttpRequest.BodyPublishers.ofString(body.toString()));else builder.GET();
        return HTTP.sendAsync(builder.build(),HttpResponse.BodyHandlers.ofString()).thenApply(r->{JsonObject data=JsonParser.parseString(r.body()).getAsJsonObject();if(r.statusCode()>=400)throw new IllegalStateException(str(data,"error","建筑菜单请求失败"));return data;});
    }
    private String error(Throwable e){while(e.getCause()!=null)e=e.getCause();return e.getMessage()==null?"连接失败，请确认机器人已启动（端口 52592）":e.getMessage();}
    private void capture(){if(xField!=null){sx=xField.getText();sy=yField.getText();sz=zField.getText();size=sizeField.getText();}}
    private void refresh(){capture();clearAndInit();}
    private ButtonWidget button(String label,int x,int y,int w,Runnable action){return addDrawableChild(ButtonWidget.builder(Text.literal(label),b->action.run()).dimensions(x,y,w,20).build());}
    private TextFieldWidget field(String label,String value,int x,int y,int w){var f=new TextFieldWidget(textRenderer,x,y,w,18,Text.literal(label));f.setMaxLength(10);f.setText(value);addDrawableChild(f);return f;}
    private List<JsonObject> filtered(){var result=new ArrayList<JsonObject>();for(var value:items){var item=value.getAsJsonObject();if(category.equals("全部")||str(item,"category","").equals(category))result.add(item);}return result;}
    @Override protected void init(){
        pw=Math.min(590,width-16);ph=Math.min(340,height-16);px=(width-pw)/2;py=(height-ph)/2;leftWidth=Math.min(190,pw/3);rows=Math.max(2,(ph-130)/26);
        String[] tabs={"全部","建筑图纸","迷宫","基础房型"};for(int i=0;i<tabs.length;i++){String tab=tabs[i];button(tab,px+12+i*(pw-52)/4,py+42,(pw-64)/4,()->{category=tab;page=0;refresh();});}
        button("放大预览",px+pw-92,py+9,80,()->{if(selected!=null){capture();client.setScreen(new PreviewScreen(this,selected));}});
        var list=filtered();int pages=Math.max(1,(list.size()+rows-1)/rows);page=Math.clamp(page,0,pages-1);
        for(int i=0;i<rows&&page*rows+i<list.size();i++){var item=list.get(page*rows+i);String label=str(item,"label","");if(selected!=null&&str(selected,"id","").equals(str(item,"id","")))label="▶ "+label;button(textRenderer.trimToWidth(label,leftWidth-20),px+12,py+70+i*26,leftWidth-8,()->{selected=item;clearTerrain=false;refresh();});}
        button("上一页",px+12,py+ph-52,(leftWidth-16)/2,()->{page=Math.max(0,page-1);refresh();});button("下一页",px+16+(leftWidth-16)/2,py+ph-52,(leftWidth-16)/2,()->{page=Math.min(pages-1,page+1);refresh();});
        int rx=px+leftWidth+16,rw=pw-leftWidth-28,fw=Math.max(30,(rw-8)/3);
        xField=field("中心 X",sx,rx,py+ph-127,fw);yField=field("底层 Y",sy,rx+fw+4,py+ph-127,fw);zField=field("中心 Z",sz,rx+fw*2+8,py+ph-127,fw);
        sizeField=field("基础房型尺寸",size,rx+rw-34,py+84,34);sizeField.setMaxLength(2);sizeField.visible=selected!=null&&bool(selected,"procedural");
        button("我的位置",rx,py+ph-104,(rw-8)/2,()->{if(client.player!=null){capture();sx=""+client.player.getBlockX();sy=""+client.player.getBlockY();sz=""+client.player.getBlockZ();xField=null;clearAndInit();}});
        button("机器人位置",rx+(rw+8)/2,py+ph-104,(rw-8)/2,()->{if(status.has("position")&&!status.get("position").isJsonNull()){capture();var p=status.getAsJsonObject("position");sx=""+num(p,"x",0);sy=""+num(p,"y",64);sz=""+num(p,"z",0);xField=null;clearAndInit();}});
        button("清理地形："+(clearTerrain?"开启":"关闭"),rx,py+ph-79,(rw-8)/2,()->{clearTerrain=!clearTerrain;refresh();});button("本次指令："+(allowCommands?"授权":"默认"),rx+(rw+8)/2,py+ph-79,(rw-8)/2,()->{allowCommands=!allowCommands;refresh();});
        int bw=(rw-8)/3;buildButton=button("建造",rx,py+ph-52,bw,()->send(false,false));resumeButton=button("续建",rx+bw+4,py+ph-52,bw,()->send(true,false));stopButton=button("停止",rx+bw*2+8,py+ph-52,bw,()->send(false,true));
        if(!started){started=true;request("/api/build/session",null).thenCompose(session->{token=str(session,"token","");return request("/api/build/catalog",null);}).whenComplete((data,e)->client.execute(()->{if(e!=null){message=error(e);return;}items=data.getAsJsonArray("items");if(!items.isEmpty()){selected=items.get(0).getAsJsonObject();for(var item:items)if(str(item.getAsJsonObject(),"id","").equals("maze-fallout"))selected=item.getAsJsonObject();}message="选择建筑，确认坐标后点击建造";refresh();nextPoll=0;}));}
    }
    private void send(boolean resume,boolean stop){
        if(sending||token.isEmpty())return;JsonObject body=new JsonObject();body.addProperty("viewer",viewer());body.addProperty("action",stop?"stop":"build");
        if(!stop){if(selected==null)return;capture();body.addProperty("id",str(selected,"id",""));body.addProperty("resume",resume);body.addProperty("clearTerrain",clearTerrain);body.addProperty("allowCommands",allowCommands);try{body.addProperty("size",Integer.parseInt(size));JsonObject p=new JsonObject();p.addProperty("x",Integer.parseInt(sx));p.addProperty("y",Integer.parseInt(sy));p.addProperty("z",Integer.parseInt(sz));body.add("position",p);}catch(NumberFormatException e){message="坐标和尺寸必须是整数";return;}}
        sending=true;request("/api/build/action",body).whenComplete((data,e)->client.execute(()->{sending=false;message=e==null?str(data,"message","已发送"):error(e);nextPoll=0;}));
    }
    @Override public void tick(){
        super.tick();long now=System.currentTimeMillis();if(!token.isEmpty()&&!polling&&now>=nextPoll){polling=true;nextPoll=now+1000;request("/api/build/status",null).whenComplete((data,e)->client.execute(()->{polling=false;if(e==null)status=data;else message=error(e);}));}
        boolean dimensionsReady=true;
        if(selected!=null&&bool(selected,"procedural")){try{int requested=Integer.parseInt(sizeField.getText());dimensionsReady=requested==num(selected,"parameterSize",5);if(!dimensionsReady&&!previewLoading&&requested>=3&&requested<=64){previewLoading=true;String id=str(selected,"id","");request("/api/build/entry?id="+id+"&size="+requested,null).whenComplete((data,e)->client.execute(()->{previewLoading=false;if(e==null&&selected!=null&&str(selected,"id","").equals(id))selected=data;else if(e!=null)message=error(e);}));}}catch(NumberFormatException e){dimensionsReady=false;}}
        boolean ready=!sending&&!token.isEmpty()&&bool(status,"connected"),permitted=bool(status,"commandAllowed")||allowCommands;if(buildButton!=null){buildButton.active=ready&&permitted&&dimensionsReady&&!bool(status,"busy")&&selected!=null&&!selected.has("error");stopButton.active=ready&&bool(status,"busy");resumeButton.active=ready&&permitted&&!bool(status,"busy")&&selected!=null&&status.has("resume")&&!status.get("resume").isJsonNull()&&str(status.getAsJsonObject("resume"),"id","").equals(str(selected,"id",""));}
    }
    @Override public void render(DrawContext c,int mouseX,int mouseY,float delta){
        c.fill(0,0,width,height,0xbb08131d);c.fill(px,py,px+pw,py+ph,0xff162630);c.fill(px+leftWidth+6,py+68,px+leftWidth+7,py+ph-30,0xff3d535d);
        c.drawText(textRenderer,textRenderer.trimToWidth("CLAUDE-BOT  /  建筑图纸",pw-116),px+12,py+12,0xffa4e3cd,false);String connection=bool(status,"connected")?"在线":"连接中",mode=str(status,"gameMode","").equals("creative")?"创造模式":"非创造模式";c.drawText(textRenderer,connection+" · "+mode+" · "+items.size()+" 种建筑",px+12,py+28,0xff9eb7bc,false);
        int rx=px+leftWidth+16,rw=pw-leftWidth-28;
        if(selected!=null){c.drawText(textRenderer,textRenderer.trimToWidth(str(selected,"label",""),rw),rx,py+69,0xfff0e8d6,false);
            if(selected.has("size")){var s=selected.getAsJsonObject("size");String text=num(s,"x",0)+"×"+num(s,"z",0)+" · 高 "+num(s,"y",0)+" · "+num(selected,"blocks",0)+" 方块";c.drawText(textRenderer,textRenderer.trimToWidth(text,rw-40),rx,py+86,0xff9eb7bc,false);}
            if(selected.has("preview")&&ph>=290){var p=selected.getAsJsonObject("preview");int w=num(p,"width",1),d=num(p,"depth",1),scale=Math.max(1,Math.min((rw-8)/w,(ph-243)/d)),ox=rx+(rw-w*scale)/2,oy=py+101;var cells=p.getAsJsonArray("cells");c.fill(rx,oy-2,rx+rw,oy+d*scale+2,0xff0d1b24);for(int i=0;i<cells.size();i++){int color=(int)cells.get(i).getAsJsonArray().get(0).getAsLong();if(color!=0)c.fill(ox+i%w*scale,oy+i/w*scale,ox+(i%w+1)*scale,oy+(i/w+1)*scale,color);}c.drawText(textRenderer,"图纸俯视预览",rx+4,oy+3,0xffe4ece8,false);}
        }
        if(ph>=290)c.drawText(textRenderer,"中心 X / 底层 Y / 中心 Z",rx,py+ph-140,0xff9eb7bc,false);super.render(c,mouseX,mouseY,delta);
        String footer=message;int color=0xffb7c9c6;if(bool(status,"busy")){footer=str(status,"task","正在执行任务");if(status.has("progress")&&!status.get("progress").isJsonNull()){var p=status.getAsJsonObject("progress");int done=num(p,"done",0),total=num(p,"total",1);footer=done+" / "+total+" 方块 · "+(int)(100.0*done/Math.max(1,total))+"% · "+str(status,"task","");c.fill(px+12,py+ph-9,px+pw-12,py+ph-6,0xff31464f);c.fill(px+12,py+ph-9,px+12+(int)((pw-24)*Math.clamp((double)done/Math.max(1,total),0,1)),py+ph-6,0xff83d3b0);}}else if(status.has("lastResult")&&!status.get("lastResult").isJsonNull()){var result=status.getAsJsonObject("lastResult");footer=str(result,"message",message);if(!bool(result,"success"))color=0xffefb39a;}else if(clearTerrain){footer="已开启地形清理：建造会移除选中范围内的原方块";color=0xffefb39a;}c.drawText(textRenderer,textRenderer.trimToWidth(footer,pw-24),px+12,py+ph-25,color,false);
    }
    @Override public boolean shouldPause(){return false;}
    @Override public void close(){client.setScreen(null);}
    private static class PreviewScreen extends Screen {
        private final BotBuildScreen parent;private final JsonObject item;
        PreviewScreen(BotBuildScreen parent,JsonObject item){super(Text.literal(str(item,"label","建筑预览")));this.parent=parent;this.item=item;}
        @Override protected void init(){addDrawableChild(ButtonWidget.builder(Text.literal("返回建筑菜单"),b->close()).dimensions(width/2-70,height-28,140,20).build());}
        @Override public void render(DrawContext c,int mx,int my,float delta){
            c.fill(0,0,width,height,0xff101f29);c.drawText(textRenderer,str(item,"label","")+" · 图纸俯视预览",12,12,0xffa4e3cd,false);
            if(item.has("preview")){var p=item.getAsJsonObject("preview");int w=num(p,"width",1),d=num(p,"depth",1),scale=Math.max(1,Math.min((width-32)/w,(height-74)/d)),ox=(width-w*scale)/2,oy=32;var cells=p.getAsJsonArray("cells");for(int i=0;i<cells.size();i++){int color=(int)cells.get(i).getAsJsonArray().get(0).getAsLong();if(color!=0)c.fill(ox+i%w*scale,oy+i/w*scale,ox+(i%w+1)*scale,oy+(i/w+1)*scale,color);}}
            super.render(c,mx,my,delta);
        }
        @Override public boolean shouldPause(){return false;}
        @Override public void close(){client.setScreen(parent);}
    }
}
