// Particle effects (cc.ParticleSystem, all configured in code) and scene
// fade transitions. Call Fx.setFrame(white) once textures are loaded.
//
// The five distinct particle effects required by the spec:
//   1. death explosion   2. crystal sparkle   3. teleport swirl
//   4. flip dust         5. portal ambient (continuous)
// (+ confetti for the win animation, afterimages for the dash action)

export default class Fx {
    private static frame: cc.SpriteFrame = null;
    private static pixelFont: cc.BitmapFont = null;
    private static fading = false;

    static setFrame(f: cc.SpriteFrame) {
        Fx.frame = f;
    }

    static setPixelFont(f: cc.BitmapFont) {
        Fx.pixelFont = f;
    }

    // The pixel bitmap font only contains ASCII glyphs. Apply it only when
    // the text is pure ASCII; otherwise fall back to the system font so
    // CJK / kana (e.g. Japanese song titles) still render.
    static applyFont(lb: cc.Label, text: string) {
        if (!lb) return;
        const t = text || "";
        let ascii = true;
        for (let i = 0; i < t.length; i++) {
            if (t.charCodeAt(i) > 126) { ascii = false; break; }
        }
        lb.font = (ascii && Fx.pixelFont) ? Fx.pixelFont : null;
    }

    static isFading(): boolean {
        return Fx.fading;
    }

    private static ps(parent: cc.Node, x: number, y: number): cc.ParticleSystem {
        const n = new cc.Node("fx");
        n.setPosition(x, y);
        n.zIndex = 50;
        parent.addChild(n);
        const p = n.addComponent(cc.ParticleSystem);
        p.custom = true;
        p.spriteFrame = Fx.frame;
        p.autoRemoveOnFinish = true;
        return p;
    }

    // 1. death explosion
    static death(parent: cc.Node, x: number, y: number, tint: cc.Color) {
        if (!Fx.frame || !parent || !parent.isValid) return;
        const p = Fx.ps(parent, x, y);
        p.totalParticles = 50;
        p.duration = 0.12;
        p.emissionRate = 500;
        p.life = 0.45;
        p.lifeVar = 0.2;
        p.startSize = 10;
        p.startSizeVar = 5;
        p.endSize = 2;
        p.startColor = cc.color(tint.r, tint.g, tint.b, 255);
        p.endColor = cc.color(255, 90, 100, 0);
        p.angle = 90;
        p.angleVar = 180;
        p.speed = 320;
        p.speedVar = 140;
        p.gravity = cc.v2(0, 0);
        p.posVar = cc.v2(8, 8);
    }

    // 2. crystal pickup sparkle
    static crystal(parent: cc.Node, x: number, y: number, tint: cc.Color) {
        if (!Fx.frame || !parent || !parent.isValid) return;
        const p = Fx.ps(parent, x, y);
        p.totalParticles = 16;
        p.duration = 0.08;
        p.emissionRate = 300;
        p.life = 0.35;
        p.lifeVar = 0.1;
        p.startSize = 6;
        p.startSizeVar = 3;
        p.endSize = 1;
        p.startColor = cc.color(tint.r, tint.g, tint.b, 255);
        p.endColor = cc.color(255, 255, 255, 0);
        p.angle = 90;
        p.angleVar = 180;
        p.speed = 150;
        p.speedVar = 60;
        p.gravity = cc.v2(0, 0);
    }

    // 3. teleport swirl (used at both entry and exit)
    static teleport(parent: cc.Node, x: number, y: number) {
        if (!Fx.frame || !parent || !parent.isValid) return;
        const p = Fx.ps(parent, x, y);
        p.totalParticles = 30;
        p.duration = 0.15;
        p.emissionRate = 250;
        p.life = 0.5;
        p.lifeVar = 0.15;
        p.startSize = 8;
        p.endSize = 2;
        p.startColor = cc.color(190, 120, 255, 255);
        p.endColor = cc.color(120, 255, 210, 0);
        p.angle = 90;
        p.angleVar = 180;
        p.speed = 110;
        p.speedVar = 50;
        p.tangentialAccel = 320; // swirl
        p.gravity = cc.v2(0, 0);
        p.posVar = cc.v2(14, 14);
    }

    // 4. flip dust kicked off the surface
    static flipDust(parent: cc.Node, x: number, y: number, gravityDir: number) {
        if (!Fx.frame || !parent || !parent.isValid) return;
        const p = Fx.ps(parent, x, y);
        p.totalParticles = 12;
        p.duration = 0.06;
        p.emissionRate = 300;
        p.life = 0.3;
        p.lifeVar = 0.1;
        p.startSize = 7;
        p.startSizeVar = 3;
        p.endSize = 1;
        p.startColor = cc.color(220, 235, 255, 200);
        p.endColor = cc.color(220, 235, 255, 0);
        p.angle = gravityDir > 0 ? 270 : 90; // puff back toward the old surface
        p.angleVar = 40;
        p.speed = 120;
        p.speedVar = 50;
        p.gravity = cc.v2(0, 0);
        p.posVar = cc.v2(12, 4);
    }

    // 5. continuous portal ambient sparks
    static portalAmbient(parent: cc.Node, x: number, y: number, tint: cc.Color): cc.ParticleSystem {
        if (!Fx.frame || !parent || !parent.isValid) return null;
        const p = Fx.ps(parent, x, y);
        p.totalParticles = 40;
        p.duration = -1; // forever
        p.emissionRate = 26;
        p.life = 1.4;
        p.lifeVar = 0.4;
        p.startSize = 6;
        p.startSizeVar = 3;
        p.endSize = 1;
        p.startColor = cc.color(tint.r, tint.g, tint.b, 200);
        p.endColor = cc.color(tint.r, tint.g, tint.b, 0);
        p.angle = 90;
        p.angleVar = 180;
        p.speed = 40;
        p.speedVar = 25;
        p.gravity = cc.v2(0, 0);
        p.posVar = cc.v2(20, 230);
        return p;
    }

    // win celebration burst
    static confetti(parent: cc.Node, x: number, y: number) {
        if (!Fx.frame || !parent || !parent.isValid) return;
        const p = Fx.ps(parent, x, y);
        p.totalParticles = 80;
        p.duration = 0.25;
        p.emissionRate = 380;
        p.life = 1.0;
        p.lifeVar = 0.4;
        p.startSize = 9;
        p.startSizeVar = 4;
        p.endSize = 3;
        p.startColor = cc.color(255, 220, 120, 255);
        p.startColorVar = cc.color(0, 80, 120, 0);
        p.endColor = cc.color(255, 255, 255, 0);
        p.angle = 90;
        p.angleVar = 180;
        p.speed = 260;
        p.speedVar = 120;
        p.gravity = cc.v2(0, -320);
        p.posVar = cc.v2(20, 20);
    }

    // dash afterimage ghost (action animation)
    static ghost(parent: cc.Node, src: cc.Node) {
        if (!parent || !parent.isValid || !src || !src.isValid) return;
        const sp = src.getComponent(cc.Sprite);
        if (!sp || !sp.spriteFrame) return;
        const n = new cc.Node("ghost");
        const gs = n.addComponent(cc.Sprite);
        gs.spriteFrame = sp.spriteFrame;
        gs.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        n.setContentSize(src.width, src.height);
        n.setPosition(src.x, src.y);
        n.scaleX = src.scaleX;
        n.scaleY = src.scaleY;
        n.angle = src.angle;
        n.opacity = 140;
        n.color = cc.color(140, 230, 255);
        n.zIndex = 4;
        parent.addChild(n);
        cc.tween(n)
            .to(0.3, { opacity: 0 })
            .call(() => n.destroy())
            .start();
    }


    // rhythm red-note hop burst
    static rhythmJump(parent: cc.Node, x: number, y: number, gravityDir: number) {
        if (!Fx.frame || !parent || !parent.isValid) return;
        const p = Fx.ps(parent, x, y);
        p.totalParticles = 20;
        p.duration = 0.08;
        p.emissionRate = 360;
        p.life = 0.32;
        p.lifeVar = 0.10;
        p.startSize = 7;
        p.startSizeVar = 3;
        p.endSize = 1;
        p.startColor = cc.color(255, 82, 78, 230);
        p.endColor = cc.color(255, 230, 210, 0);
        p.angle = gravityDir > 0 ? 270 : 90;
        p.angleVar = 55;
        p.speed = 160;
        p.speedVar = 70;
        p.gravity = cc.v2(0, 0);
        p.posVar = cc.v2(10, 6);
    }

    // rhythm blue-note gravity flip burst
    static rhythmFlip(parent: cc.Node, x: number, y: number) {
        if (!Fx.frame || !parent || !parent.isValid) return;
        const p = Fx.ps(parent, x, y);
        p.totalParticles = 34;
        p.duration = 0.12;
        p.emissionRate = 420;
        p.life = 0.42;
        p.lifeVar = 0.12;
        p.startSize = 8;
        p.startSizeVar = 4;
        p.endSize = 1;
        p.startColor = cc.color(85, 185, 255, 245);
        p.endColor = cc.color(220, 250, 255, 0);
        p.angle = 90;
        p.angleVar = 180;
        p.speed = 210;
        p.speedVar = 90;
        p.tangentialAccel = 260;
        p.gravity = cc.v2(0, 0);
        p.posVar = cc.v2(12, 12);
    }

    static rhythmMiss(parent: cc.Node, x: number, y: number) {
        if (!Fx.frame || !parent || !parent.isValid) return;
        const p = Fx.ps(parent, x, y);
        p.totalParticles = 12;
        p.duration = 0.06;
        p.emissionRate = 250;
        p.life = 0.25;
        p.lifeVar = 0.06;
        p.startSize = 9;
        p.startSizeVar = 3;
        p.endSize = 1;
        p.startColor = cc.color(255, 90, 100, 210);
        p.endColor = cc.color(255, 90, 100, 0);
        p.angle = 90;
        p.angleVar = 180;
        p.speed = 120;
        p.speedVar = 60;
        p.gravity = cc.v2(0, 0);
        p.posVar = cc.v2(8, 8);
    }

    static brakeBurst(parent: cc.Node, x: number, y: number) {
        if (!Fx.frame || !parent || !parent.isValid) return;
        const p = Fx.ps(parent, x, y);
        p.totalParticles = 34;
        p.duration = 0.16;
        p.emissionRate = 360;
        p.life = 0.45;
        p.lifeVar = 0.12;
        p.startSize = 10;
        p.startSizeVar = 4;
        p.endSize = 2;
        p.startColor = cc.color(160, 150, 255, 230);
        p.endColor = cc.color(90, 220, 255, 0);
        p.angle = 180;
        p.angleVar = 35;
        p.speed = 180;
        p.speedVar = 60;
        p.radialAccel = -160;
        p.gravity = cc.v2(0, 0);
        p.posVar = cc.v2(14, 10);
    }

    static slamBurst(parent: cc.Node, x: number, y: number, gravityDir: number) {
        if (!Fx.frame || !parent || !parent.isValid) return;
        const p = Fx.ps(parent, x, y);
        p.totalParticles = 44;
        p.duration = 0.12;
        p.emissionRate = 520;
        p.life = 0.38;
        p.lifeVar = 0.12;
        p.startSize = 12;
        p.startSizeVar = 5;
        p.endSize = 2;
        p.startColor = cc.color(255, 181, 74, 245);
        p.endColor = cc.color(255, 80, 80, 0);
        p.angle = gravityDir > 0 ? 90 : 270;
        p.angleVar = 34;
        p.speed = 260;
        p.speedVar = 90;
        p.gravity = cc.v2(0, 0);
        p.posVar = cc.v2(16, 8);
    }

    static popup(parent: cc.Node, x: number, y: number, text: string, color: cc.Color) {
        if (!parent || !parent.isValid) return;
        const n = new cc.Node("popup");
        const l = n.addComponent(cc.Label);
        l.string = text;
        Fx.applyFont(l, text);
        l.fontSize = 24;
        l.lineHeight = 26;
        n.color = color;
        n.opacity = 255;
        n.setPosition(x, y);
        n.zIndex = 120;
        parent.addChild(n);
        cc.tween(n)
            .parallel(
                cc.tween().by(0.45, { y: 42 }),
                cc.tween().to(0.45, { opacity: 0, scale: 1.35 })
            )
            .call(() => n.destroy())
            .start();
    }

    // ---------- scene fade transitions ----------

    // `parent` must be a node glued to the camera (hud / menu canvas / editor ui).
    static fadeTo(scene: string, parent: cc.Node) {
        if (Fx.fading) return;
        (window as any).__gfrSceneHint = scene;
        if (!Fx.frame || !parent || !parent.isValid) {
            cc.director.loadScene(scene);
            return;
        }
        Fx.fading = true;
        const n = new cc.Node("fadeOut");
        const sp = n.addComponent(cc.Sprite);
        sp.spriteFrame = Fx.frame;
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        n.setContentSize(1700, 1100);
        n.color = cc.color(0, 0, 0);
        n.opacity = 0;
        n.zIndex = 999;
        parent.addChild(n);
        const line = new cc.Node("fadeLine");
        const lineSp = line.addComponent(cc.Sprite);
        lineSp.spriteFrame = Fx.frame;
        lineSp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        line.setContentSize(1700, 4);
        line.color = cc.color(127, 247, 255);
        line.opacity = 0;
        line.setPosition(0, 220);
        line.zIndex = 1000;
        parent.addChild(line);
        cc.tween(n)
            .to(0.36, { opacity: 255 })
            .call(() => cc.director.loadScene(scene))
            .start();
        cc.tween(line)
            .parallel(
                cc.tween().to(0.36, { y: -220 }),
                cc.tween().to(0.14, { opacity: 230 }).delay(0.1).to(0.12, { opacity: 0 })
            )
            .start();
    }

    static fadeIn(parent: cc.Node) {
        Fx.fading = false;
        if (!Fx.frame || !parent || !parent.isValid) return;
        const n = new cc.Node("fadeIn");
        const sp = n.addComponent(cc.Sprite);
        sp.spriteFrame = Fx.frame;
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        n.setContentSize(1700, 1100);
        n.color = cc.color(0, 0, 0);
        n.opacity = 255;
        n.zIndex = 999;
        parent.addChild(n);
        cc.tween(n)
            .to(0.42, { opacity: 0 })
            .call(() => n.destroy())
            .start();
    }
}
