// Shadow Puppet Control System
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('video');
const statusEl = document.getElementById('status');
const handCanvas = document.getElementById('handCanvas');
const handCtx = handCanvas ? handCanvas.getContext('2d') : null;

// Canvas setup
canvas.width = 1400; // 增加宽度
canvas.height = 1100; // 再增加高度，确保脚部完全显示

// Image loading
const images = {
    head: null,
    torso: null,
    leftArm: null,
    leftHand: null,
    rightArm: null,
    rightHand: null,
    legs: null,
    leftFoot: null,
    rightFoot: null,
    // 背景道具
    chair1: null,
    chair2: null,
    desk: null,
    table1: null,
    table2: null
};

let imagesLoaded = 0;
const totalImages = 14; // 9个人物部件 + 5个道具

function loadImage(key, path, crop = null) {
    const img = new Image();
    img.onload = () => {
        images[key] = { img, crop };
        imagesLoaded++;
        console.log(`Loaded ${key}: ${img.width}x${img.height}`);
        if (imagesLoaded === totalImages) {
            statusEl.textContent = '素材加载完成 - 用鼠标拖动影人双手，或启用手势操纵';
        } else {
            statusEl.textContent = `加载素材 ${imagesLoaded}/${totalImages}...`;
        }
    };
    img.onerror = () => {
        console.error(`Failed to load: ${path}`);
        // 道具加载失败不影响主程序
        if (key === 'chair1' || key === 'chair2' || key === 'desk' || key === 'table1' || key === 'table2') {
            imagesLoaded++;
            console.log(`Skipped prop: ${key}`);
            if (imagesLoaded === totalImages) {
                statusEl.textContent = '素材加载完成 - 用鼠标拖动影人双手，或启用手势操纵';
            }
        } else {
            statusEl.textContent = `加载失败: ${path}`;
            imagesLoaded++;
        }
    };
    img.src = path;
}

// 加载杨贵妃皮影戏素材
loadImage('head', 'assets/images/main.png', { y: 0, height: 0.25 });
loadImage('torso', 'assets/images/torso_躯干部.png');
loadImage('leftArm', 'assets/images/left-arm_左臂.png');
loadImage('leftHand', 'assets/images/left-hand_左手.png');
loadImage('rightArm', 'assets/images/right-arm_右臂.png');
loadImage('rightHand', 'assets/images/right-hand_右手.png');
loadImage('legs', 'assets/images/legs_腿部.png');
loadImage('leftFoot', 'assets/images/left-foot_左脚.png');
loadImage('rightFoot', 'assets/images/right-foot_右脚.png');

// 加载背景道具
loadImage('chair1', 'assets/images/chair_相椅.png');
loadImage('chair2', 'assets/images/chair-copy_相椅副本.png');
loadImage('desk', 'assets/images/desk_书桌.png');
loadImage('table1', 'assets/images/swastika-table_万字花几.png');
loadImage('table2', 'assets/images/swastika-table-copy_万字花几副本.png');

// Physics constants
const LERP_FACTOR = 0.18;
const SPRING_K = 0.08;  // 减小弹簧力，让动作更柔和
const DAMPING = 0.92;   // 增加阻尼，减少抖动
const GRAVITY = 0.8;    // 增加重力，让身体自然下垂
const BODY_FOLLOW = 0.003; // 身体跟随手部的速度（更慢）

// Puppet configuration from builder
const puppetConfig = {
    head: { x: 586, y: 232, scale: 0.200, rotation: 0, pivot: { x: 589, y: 282 } },      // 0.040 -> 0.200
    torso: { x: 600, y: 400, scale: 0.375, rotation: 0, pivot: { x: 590, y: 470 } },     // 0.075 -> 0.375
    legs: { x: 601, y: 530, scale: 0.375, rotation: 0, pivot: { x: 599, y: 470 } },      // 0.075 -> 0.375
    leftFoot: { x: 561, y: 648, scale: 0.300, rotation: 0, pivot: { x: 576, y: 581 } },  // 0.060 -> 0.300
    rightFoot: { x: 658, y: 659, scale: 0.300, rotation: 0, pivot: { x: 628, y: 587 } }, // 0.060 -> 0.300
    leftArm: { x: 579, y: 355, scale: 0.300, rotation: 0, pivot: { x: 609, y: 315 } },   // 0.060 -> 0.300
    leftHand: { x: 504, y: 428, scale: 0.300, rotation: 0, pivot: { x: 557, y: 383 } },  // 0.060 -> 0.300
    rightArm: { x: 647, y: 352, scale: 0.300, rotation: 0, pivot: { x: 616, y: 317 } },  // 0.060 -> 0.300
    rightHand: { x: 690, y: 443, scale: 0.300, rotation: 0, pivot: { x: 668, y: 379 } }  // 0.060 -> 0.300
};

// 躯干的肩膀位置（用于连接头部和手臂）
const torsoShoulderY = 283; // 原来的躯干顶部位置

// 连接关系：子部件连接到父部件
// 格式：子部件ID -> 父部件ID
const connections = {
    head: 'torso',        // 头连接到躯干
    legs: 'torso',        // 腿连接到躯干
    leftFoot: 'legs',     // 左脚连接到腿
    rightFoot: 'legs',    // 右脚连接到腿
    leftArm: 'torso',     // 左臂连接到躯干
    leftHand: 'leftArm',  // 左手连接到左臂
    rightArm: 'torso',    // 右臂连接到躯干
    rightHand: 'rightArm' // 右手连接到右臂
};

class Vector2 {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    add(v) {
        return new Vector2(this.x + v.x, this.y + v.y);
    }

    sub(v) {
        return new Vector2(this.x - v.x, this.y - v.y);
    }

    mult(s) {
        return new Vector2(this.x * s, this.y * s);
    }

    mag() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    normalize() {
        const m = this.mag();
        return m > 0 ? this.mult(1 / m) : new Vector2(0, 0);
    }

    clone() {
        return new Vector2(this.x, this.y);
    }
}

class Tether {
    constructor(anchorX, anchorY, attachX, attachY) {
        this.anchor = new Vector2(anchorX, anchorY);
        this.target = new Vector2(attachX, attachY);
        this.attach = new Vector2(attachX, attachY);
        this.velocity = new Vector2(0, 0);
    }

    updateTarget(targetX, targetY) {
        this.target.x = targetX;
        this.target.y = targetY;
    }

    applyForce() {
        // Spring force from target to attachment point
        const force = this.target.sub(this.attach).mult(SPRING_K);

        // Apply force
        this.velocity = this.velocity.add(force);
        this.velocity.y += GRAVITY * 2.0; // 更强的重力让手自然下垂
        this.velocity = this.velocity.mult(DAMPING);

        // Update attachment position
        this.attach = this.attach.add(this.velocity);

        // 限制不能超出画布太多
        this.attach.x = Math.max(50, Math.min(canvas.width - 50, this.attach.x));
        this.attach.y = Math.max(100, Math.min(canvas.height - 50, this.attach.y));
    }

    draw(ctx, handWorldPos, anchorX) {
        // 绳子从顶部横梁连到手的实际位置
        ctx.strokeStyle = 'rgba(139, 115, 85, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(anchorX, 60); // 从横梁底部开始
        ctx.lineTo(handWorldPos.x, handWorldPos.y);
        ctx.stroke();

        // 在横梁上画一个小圆点表示固定点
        ctx.fillStyle = 'rgba(139, 115, 85, 0.7)';
        ctx.beginPath();
        ctx.arc(anchorX, 60, 4, 0, Math.PI * 2);
        ctx.fill();
    }
}

class ShadowPuppet {
    constructor() {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        // 身体中心 - 往上移动让脚露出来
        this.bodyCenter = new Vector2(centerX, centerY - 200);
        this.bodyVelocity = new Vector2(0, 0);

        // Tethers - 初始位置在身体下方，让手臂自然下垂
        // 左手tether在左下方，右手tether也偏左下（人物面朝左）
        this.tethers = {
            leftHand: new Tether(centerX - 100, 50, centerX - 250, centerY + 350),
            rightHand: new Tether(centerX + 100, 50, centerX - 150, centerY + 350)
        };

        // 当前旋转角度（相对于初始配置）
        this.rotations = {
            head: 0,
            torso: 0,
            legs: 0,
            leftArm: 0,    // 保持图片原始姿势
            leftHand: 0,
            rightArm: 0,   // 保持图片原始姿势
            rightHand: 0,
            leftFoot: 0,
            rightFoot: 0
        };

        // 旋转速度（用于惯性）
        this.rotationVelocities = {
            head: 0,
            torso: 0,
            legs: 0,
            leftArm: 0,
            leftHand: 0,
            rightArm: 0,
            rightHand: 0,
            leftFoot: 0,
            rightFoot: 0
        };

        // 重力加速度（每个部件受重力影响）
        this.gravityForces = {
            leftArm: 0,
            leftHand: 0,
            rightArm: 0,
            rightHand: 0,
            leftFoot: 0,
            rightFoot: 0
        };

        // 初始化手的世界位置
        this.leftHandWorld = new Vector2(centerX - 80, centerY + 200);
        this.rightHandWorld = new Vector2(centerX + 80, centerY + 200);
        this.leftElbowWorld = new Vector2(centerX, centerY);
        this.rightElbowWorld = new Vector2(centerX, centerY);
    }

    update() {
        // Update tether physics
        Object.values(this.tethers).forEach(t => t.applyForce());

        // 身体受重力影响，主要跟随左手（前面的手），右手几乎不影响
        const leftWeight = 0.9;   // 左手权重很高
        const rightWeight = 0.1;  // 右手权重很低
        const avgHandX = this.tethers.leftHand.attach.x * leftWeight + this.tethers.rightHand.attach.x * rightWeight;
        const avgHandY = this.tethers.leftHand.attach.y * leftWeight + this.tethers.rightHand.attach.y * rightWeight;

        // 计算身体应该在的位置（手的下方偏右，因为人物面朝左）
        const targetBodyX = avgHandX + 100;
        const targetBodyY = avgHandY + 200; // 身体在手下方更远

        // 身体受重力和手部拉力的影响（移动更慢）
        const pullForce = new Vector2(
            (targetBodyX - this.bodyCenter.x) * 0.001, // 更慢的横向跟随
            (targetBodyY - this.bodyCenter.y) * 0.002  // 更慢的纵向跟随
        );

        this.bodyVelocity = this.bodyVelocity.add(pullForce);
        this.bodyVelocity.y += GRAVITY * 0.3; // 减少重力影响
        this.bodyVelocity = this.bodyVelocity.mult(0.95); // 更大阻尼

        // 限制最大速度，防止突然窜出去
        const maxSpeed = 3;
        const speed = this.bodyVelocity.mag();
        if (speed > maxSpeed) {
            this.bodyVelocity = this.bodyVelocity.mult(maxSpeed / speed);
        }

        this.bodyCenter = this.bodyCenter.add(this.bodyVelocity);

        // 限制身体不要飞出画布
        this.bodyCenter.y = Math.max(300, Math.min(canvas.height - 350, this.bodyCenter.y)); // 给脚部留出更多空间

        // === 躯干 - 醉酒摇晃效果 ===
        // 使用正弦波产生缓慢的左右摇晃
        const time = Date.now() / 1000; // 当前时间（秒）
        const swayAmount = 8; // 摇晃幅度（度）
        const swaySpeed = 0.5; // 摇晃速度（越小越慢）
        const sway = Math.sin(time * swaySpeed) * swayAmount;

        // 加一点随机的微小晃动，更自然
        const wobble = Math.sin(time * 1.7) * 2 + Math.sin(time * 2.3) * 1.5;

        // 目标角度 = 基础摇晃 + 微晃
        const torsoTargetAngle = sway + wobble;

        // 躯干缓慢过渡到目标角度
        this.rotationVelocities.torso += (torsoTargetAngle - this.rotations.torso) * 0.02;
        this.rotationVelocities.torso *= 0.95;
        this.rotations.torso += this.rotationVelocities.torso;
        this.rotations.torso = Math.max(-25, Math.min(25, this.rotations.torso));

        // === 腿部跟随躯干 ===
        this.rotations.legs = this.rotations.torso * 0.5;

        const leftArmCfg = puppetConfig.leftArm;
        const torsoCfg = puppetConfig.torso;
        const leftHandCfg = puppetConfig.leftHand;
        const rightArmCfg = puppetConfig.rightArm;
        const rightHandCfg = puppetConfig.rightHand;

        // 计算躯干pivot的世界坐标
        const torsoWorld = new Vector2(
            this.bodyCenter.x + (torsoCfg.pivot.x - 600),
            this.bodyCenter.y + (torsoCfg.pivot.y - 400)
        );

        // 应用躯干旋转
        const torsoRot = this.rotations.torso * Math.PI / 180;
        const torsocos = Math.cos(torsoRot);
        const torsosin = Math.sin(torsoRot);

        // === 左臂 ===
        const leftShoulderOffsetX = leftArmCfg.pivot.x - torsoCfg.pivot.x;
        const leftShoulderOffsetY = leftArmCfg.pivot.y - torsoCfg.pivot.y;
        const leftShoulderWorld = new Vector2(
            torsoWorld.x + (leftShoulderOffsetX * torsocos - leftShoulderOffsetY * torsosin),
            torsoWorld.y + (leftShoulderOffsetX * torsosin + leftShoulderOffsetY * torsocos)
        );

        // 图片中左臂的初始方向角度（从肩膀pivot到手pivot）
        // leftArm pivot: (609, 315), leftHand pivot: (557, 383)
        // dx = 557 - 609 = -52, dy = 383 - 315 = 68
        // 初始角度 = atan2(68, -52) ≈ 127° (指向左下)
        const LEFT_ARM_IMAGE_ANGLE = Math.atan2(
            leftHandCfg.pivot.y - leftArmCfg.pivot.y,
            leftHandCfg.pivot.x - leftArmCfg.pivot.x
        ); // 约 127° 或 2.22 弧度

        // 计算从肩膀到tether的目标角度
        const leftTether = this.tethers.leftHand.attach;
        const leftTargetAngle = Math.atan2(
            leftTether.y - leftShoulderWorld.y,
            leftTether.x - leftShoulderWorld.x
        );

        // 需要旋转的角度 = 目标角度 - 图片初始角度
        let leftArmTargetRot = (leftTargetAngle - LEFT_ARM_IMAGE_ANGLE) * 180 / Math.PI;

        // 归一化到 -180° 到 +180° 范围
        while (leftArmTargetRot > 180) leftArmTargetRot -= 360;
        while (leftArmTargetRot < -180) leftArmTargetRot += 360;

        // 限制左臂旋转范围：负值=逆时针（往左上抬），正值=顺时针（往右下）
        // 左臂要能往左抬高，所以允许更大的负值
        leftArmTargetRot = Math.max(-100, Math.min(40, leftArmTargetRot));

        // 平滑过渡到目标角度
        this.rotations.leftArm += (leftArmTargetRot - this.rotations.leftArm) * 0.1;

        // 计算肘部世界位置
        const elbowLocalX = leftHandCfg.pivot.x - leftArmCfg.pivot.x;
        const elbowLocalY = leftHandCfg.pivot.y - leftArmCfg.pivot.y;
        const leftArmWorldAngle = (this.rotations.torso + this.rotations.leftArm) * Math.PI / 180;
        const cos = Math.cos(leftArmWorldAngle);
        const sin = Math.sin(leftArmWorldAngle);
        this.leftElbowWorld = new Vector2(
            leftShoulderWorld.x + (elbowLocalX * cos - elbowLocalY * sin),
            leftShoulderWorld.y + (elbowLocalX * sin + elbowLocalY * cos)
        );

        // 左手位置
        const leftHandLocalX = leftHandCfg.x - leftHandCfg.pivot.x;
        const leftHandLocalY = leftHandCfg.y - leftHandCfg.pivot.y;
        const leftHandWorldAngle = (this.rotations.torso + this.rotations.leftArm + this.rotations.leftHand) * Math.PI / 180;
        const cos2 = Math.cos(leftHandWorldAngle);
        const sin2 = Math.sin(leftHandWorldAngle);
        this.leftHandWorld = new Vector2(
            this.leftElbowWorld.x + (leftHandLocalX * cos2 - leftHandLocalY * sin2),
            this.leftElbowWorld.y + (leftHandLocalX * sin2 + leftHandLocalY * cos2)
        );

        // === 右臂 ===
        const rightShoulderOffsetX = rightArmCfg.pivot.x - torsoCfg.pivot.x;
        const rightShoulderOffsetY = rightArmCfg.pivot.y - torsoCfg.pivot.y;
        const rightShoulderWorld = new Vector2(
            torsoWorld.x + (rightShoulderOffsetX * torsocos - rightShoulderOffsetY * torsosin),
            torsoWorld.y + (rightShoulderOffsetX * torsosin + rightShoulderOffsetY * torsocos)
        );

        // 图片中右臂的初始方向角度（从肩膀pivot到手pivot）
        // rightArm pivot: (616, 317), rightHand pivot: (668, 379)
        // dx = 668 - 616 = 52, dy = 379 - 317 = 62
        // 初始角度 = atan2(62, 52) ≈ 50° (指向右下)
        const RIGHT_ARM_IMAGE_ANGLE = Math.atan2(
            rightHandCfg.pivot.y - rightArmCfg.pivot.y,
            rightHandCfg.pivot.x - rightArmCfg.pivot.x
        ); // 约 50° 或 0.87 弧度

        // 计算从肩膀到tether的目标角度
        const rightTether = this.tethers.rightHand.attach;
        const rightTargetAngle = Math.atan2(
            rightTether.y - rightShoulderWorld.y,
            rightTether.x - rightShoulderWorld.x
        );

        // 需要旋转的角度 = 目标角度 - 图片初始角度
        let rightArmTargetRot = (rightTargetAngle - RIGHT_ARM_IMAGE_ANGLE) * 180 / Math.PI;

        // 归一化到 -180° 到 +180° 范围
        while (rightArmTargetRot > 180) rightArmTargetRot -= 360;
        while (rightArmTargetRot < -180) rightArmTargetRot += 360;

        // 限制右臂旋转范围：负值=逆时针（往左抬），正值=顺时针（往右/后）
        // 右臂限制往右抬（正值小），允许往左抬（负值大）
        rightArmTargetRot = Math.max(-100, Math.min(10, rightArmTargetRot));

        // 平滑过渡到目标角度
        this.rotations.rightArm += (rightArmTargetRot - this.rotations.rightArm) * 0.1;

        // 右肘部位置
        const rightElbowLocalX = rightHandCfg.pivot.x - rightArmCfg.pivot.x;
        const rightElbowLocalY = rightHandCfg.pivot.y - rightArmCfg.pivot.y;
        const rightArmWorldAngle = (this.rotations.torso + this.rotations.rightArm) * Math.PI / 180;
        const cos3 = Math.cos(rightArmWorldAngle);
        const sin3 = Math.sin(rightArmWorldAngle);
        this.rightElbowWorld = new Vector2(
            rightShoulderWorld.x + (rightElbowLocalX * cos3 - rightElbowLocalY * sin3),
            rightShoulderWorld.y + (rightElbowLocalX * sin3 + rightElbowLocalY * cos3)
        );

        // 右手位置
        const rightHandLocalX = rightHandCfg.x - rightHandCfg.pivot.x;
        const rightHandLocalY = rightHandCfg.y - rightHandCfg.pivot.y;
        const rightHandWorldAngle = (this.rotations.torso + this.rotations.rightArm + this.rotations.rightHand) * Math.PI / 180;
        const cos4 = Math.cos(rightHandWorldAngle);
        const sin4 = Math.sin(rightHandWorldAngle);
        this.rightHandWorld = new Vector2(
            this.rightElbowWorld.x + (rightHandLocalX * cos4 - rightHandLocalY * sin4),
            this.rightElbowWorld.y + (rightHandLocalX * sin4 + rightHandLocalY * cos4)
        );

        // === 头部 - 醉酒晃动，比身体慢半拍 ===
        const headSway = Math.sin(time * swaySpeed - 0.5) * 5; // 延迟半拍，幅度小一点
        const headWobble = Math.sin(time * 1.3) * 3;
        const headTargetAngle = headSway + headWobble + this.rotations.torso * 0.3; // 跟随躯干

        this.rotationVelocities.head += (headTargetAngle - this.rotations.head) * 0.03;
        this.rotationVelocities.head *= 0.9;
        this.rotations.head += this.rotationVelocities.head;
        this.rotations.head = Math.max(-20, Math.min(20, this.rotations.head));

        // === 腿部和脚部 ===
        // === 脚部 - 保持初始状态，不旋转 ===
        // 脚部不需要复杂的重力计算，保持原位即可
        this.rotations.leftFoot = 0;
        this.rotations.rightFoot = 0;
    }

    // 获取部件连接点的世界坐标（考虑父部件的旋转）
    getWorldPosition(partId) {
        const cfg = puppetConfig[partId];

        // 特殊处理：左手和右手的连接点是计算出来的肘部位置
        if (partId === 'leftHand') {
            return this.leftElbowWorld;
        }
        if (partId === 'rightHand') {
            return this.rightElbowWorld;
        }

        // 躯干：直接相对于bodyCenter，考虑躯干自身旋转
        if (partId === 'torso') {
            const pivotX = cfg.pivot ? cfg.pivot.x : cfg.x;
            const pivotY = cfg.pivot ? cfg.pivot.y : cfg.y;
            return new Vector2(
                this.bodyCenter.x + (pivotX - 600),
                this.bodyCenter.y + (pivotY - 400)
            );
        }

        // 头部：连接到躯干肩膀位置，需要考虑躯干的旋转
        if (partId === 'head') {
            const torsoCfg = puppetConfig.torso;
            const torsoWorld = new Vector2(
                this.bodyCenter.x + (torsoCfg.pivot.x - 600),
                this.bodyCenter.y + (torsoCfg.pivot.y - 400)
            );

            // 头部连接点相对于躯干pivot（腰部）的偏移
            const headPivotOffsetX = cfg.pivot.x - torsoCfg.pivot.x;
            const headPivotOffsetY = cfg.pivot.y - torsoCfg.pivot.y; // 负值，因为头在腰上方

            // 应用躯干旋转
            const torsoRot = this.rotations.torso * Math.PI / 180;
            const cos = Math.cos(torsoRot);
            const sin = Math.sin(torsoRot);

            return new Vector2(
                torsoWorld.x + (headPivotOffsetX * cos - headPivotOffsetY * sin),
                torsoWorld.y + (headPivotOffsetX * sin + headPivotOffsetY * cos)
            );
        }

        // 腿部：连接到躯干底部（腰部），需要考虑躯干的旋转
        if (partId === 'legs') {
            const torsoCfg = puppetConfig.torso;
            const torsoWorld = new Vector2(
                this.bodyCenter.x + (torsoCfg.pivot.x - 600),
                this.bodyCenter.y + (torsoCfg.pivot.y - 400)
            );

            // 腿部连接点相对于躯干pivot（腰部）的偏移 - 应该是0或很小
            const legsPivotOffsetX = cfg.pivot.x - torsoCfg.pivot.x;
            const legsPivotOffsetY = cfg.pivot.y - torsoCfg.pivot.y; // 应该接近0

            // 应用躯干旋转
            const torsoRot = this.rotations.torso * Math.PI / 180;
            const cos = Math.cos(torsoRot);
            const sin = Math.sin(torsoRot);

            return new Vector2(
                torsoWorld.x + (legsPivotOffsetX * cos - legsPivotOffsetY * sin),
                torsoWorld.y + (legsPivotOffsetX * sin + legsPivotOffsetY * cos)
            );
        }

        // 脚部：连接到腿部，需要考虑躯干和腿部的旋转
        if (partId === 'leftFoot' || partId === 'rightFoot') {
            const legsCfg = puppetConfig.legs;
            const torsoCfg = puppetConfig.torso;

            // 先计算腿部pivot的世界坐标（考虑躯干旋转）
            const torsoWorld = new Vector2(
                this.bodyCenter.x + (torsoCfg.pivot.x - 600),
                this.bodyCenter.y + (torsoCfg.pivot.y - 400)
            );

            const legsPivotOffsetX = legsCfg.pivot.x - torsoCfg.pivot.x;
            const legsPivotOffsetY = legsCfg.pivot.y - torsoCfg.pivot.y;

            const torsoRot = this.rotations.torso * Math.PI / 180;
            const cos1 = Math.cos(torsoRot);
            const sin1 = Math.sin(torsoRot);

            const legsWorld = new Vector2(
                torsoWorld.x + (legsPivotOffsetX * cos1 - legsPivotOffsetY * sin1),
                torsoWorld.y + (legsPivotOffsetX * sin1 + legsPivotOffsetY * cos1)
            );

            // 脚部连接点相对于腿部pivot的偏移
            const footPivotOffsetX = cfg.pivot.x - legsCfg.pivot.x;
            const footPivotOffsetY = cfg.pivot.y - legsCfg.pivot.y;

            // 应用腿部旋转（腿部旋转是相对于躯干的）
            const legsRot = (this.rotations.torso + this.rotations.legs) * Math.PI / 180;
            const cos2 = Math.cos(legsRot);
            const sin2 = Math.sin(legsRot);

            return new Vector2(
                legsWorld.x + (footPivotOffsetX * cos2 - footPivotOffsetY * sin2),
                legsWorld.y + (footPivotOffsetX * sin2 + footPivotOffsetY * cos2)
            );
        }

        // 手臂：连接到躯干肩膀位置，需要考虑躯干的旋转
        if (partId === 'leftArm' || partId === 'rightArm') {
            const torsoCfg = puppetConfig.torso;
            const torsoWorld = new Vector2(
                this.bodyCenter.x + (torsoCfg.pivot.x - 600),
                this.bodyCenter.y + (torsoCfg.pivot.y - 400)
            );

            // 手臂连接点（肩膀）相对于躯干pivot（腰部）的偏移
            const armPivotOffsetX = cfg.pivot.x - torsoCfg.pivot.x;
            const armPivotOffsetY = cfg.pivot.y - torsoCfg.pivot.y; // 负值，因为肩膀在腰上方

            // 应用躯干旋转
            const torsoRot = this.rotations.torso * Math.PI / 180;
            const cos = Math.cos(torsoRot);
            const sin = Math.sin(torsoRot);

            return new Vector2(
                torsoWorld.x + (armPivotOffsetX * cos - armPivotOffsetY * sin),
                torsoWorld.y + (armPivotOffsetX * sin + armPivotOffsetY * cos)
            );
        }

        // 默认：直接相对于躯干
        const pivotX = cfg.pivot ? cfg.pivot.x : cfg.x;
        const pivotY = cfg.pivot ? cfg.pivot.y : cfg.y;

        return new Vector2(
            this.bodyCenter.x + (pivotX - 600),
            this.bodyCenter.y + (pivotY - 400)
        );
    }

    draw(ctx) {
        if (imagesLoaded < totalImages) {
            // 加载中不显示任何内容
            return;
        }

        // 绘制背景道具（在人物后面）
        this.drawProps(ctx);

        // 辅助函数：绘制部件（考虑父部件的变换）
        const drawPart = (partId) => {
            const cfg = puppetConfig[partId];
            const data = images[partId];
            if (!data || !data.img) return;

            const img = data.img;
            const w = img.width * cfg.scale;
            const h = img.height * cfg.scale;

            // 获取连接点的世界坐标
            const pivotWorld = this.getWorldPosition(partId);

            // 计算总旋转角度
            let totalRotation = cfg.rotation;

            // 根据部件类型累加父部件的旋转
            if (partId === 'head') {
                // 头部：受躯干旋转影响
                totalRotation += this.rotations.torso;
            } else if (partId === 'leftArm') {
                // 左臂：受躯干旋转影响
                totalRotation += this.rotations.torso;
            } else if (partId === 'rightArm') {
                // 右臂：受躯干旋转影响
                totalRotation += this.rotations.torso;
            } else if (partId === 'leftHand') {
                // 左手：受躯干和左臂旋转影响
                totalRotation += this.rotations.torso + this.rotations.leftArm;
            } else if (partId === 'rightHand') {
                // 右手：受躯干和右臂旋转影响
                totalRotation += this.rotations.torso + this.rotations.rightArm;
            } else if (partId === 'legs') {
                // 腿部：受躯干旋转影响
                totalRotation += this.rotations.torso;
            } else if (partId === 'leftFoot' || partId === 'rightFoot') {
                // 脚部：受躯干和腿部旋转影响
                totalRotation += this.rotations.torso + this.rotations.legs;
            }

            // 加上自身的动态旋转
            totalRotation += (this.rotations[partId] || 0);

            const totalRotationRad = totalRotation * Math.PI / 180;

            ctx.save();
            ctx.translate(pivotWorld.x, pivotWorld.y);
            ctx.rotate(totalRotationRad);

            // 计算部件中心相对于连接点的偏移
            let offsetX, offsetY;
            if (cfg.pivot) {
                offsetX = cfg.x - cfg.pivot.x;
                offsetY = cfg.y - cfg.pivot.y;
            } else {
                offsetX = 0;
                offsetY = 0;
            }

            if (data.crop) {
                const cropY = img.height * data.crop.y;
                const cropHeight = img.height * data.crop.height;
                const croppedH = cropHeight * cfg.scale;
                ctx.drawImage(img, 0, cropY, img.width, cropHeight,
                    offsetX - w / 2, offsetY - croppedH / 2, w, croppedH);
            } else {
                ctx.drawImage(img, offsetX - w / 2, offsetY - h / 2, w, h);
            }

            ctx.restore();
        };

        // 绘制顺序：从后往前
        drawPart('rightFoot');
        drawPart('leftFoot');
        drawPart('legs');
        drawPart('torso');
        drawPart('head');
        drawPart('rightArm');
        drawPart('rightHand');
        drawPart('leftArm');
        drawPart('leftHand');

        // Draw tethers AFTER calculating hand positions (在最后绘制绳子)
        // 绳子固定在横梁上，连接到手的实际位置
        const leftAnchorX = canvas.width / 2 - 100;
        const rightAnchorX = canvas.width / 2 + 100;
        this.tethers.leftHand.draw(ctx, this.leftHandWorld, leftAnchorX);
        this.tethers.rightHand.draw(ctx, this.rightHandWorld, rightAnchorX);
    }

    drawProps(ctx) {
        // 道具配置
        const propsConfig = {
            chair1: { x: 752, y: 359, scale: 0.400, alpha: 0.60 },   // 0.080 -> 0.400
            chair2: { x: 274, y: 357, scale: 0.400, alpha: 0.60 },   // 0.080 -> 0.400
            desk: { x: 516, y: 357, scale: 0.400, alpha: 0.60 },     // 0.080 -> 0.400
            table1: { x: 92, y: 8, scale: 0.200, alpha: 0.40 },      // 0.040 -> 0.200
            table2: { x: 964, y: 8, scale: 0.200, alpha: 0.40 }      // 0.040 -> 0.200
        };

        // 绘制所有道具
        Object.entries(propsConfig).forEach(([id, config]) => {
            if (images[id] && images[id].img) {
                const img = images[id].img;
                const w = img.width * config.scale;
                const h = img.height * config.scale;

                ctx.save();
                ctx.globalAlpha = config.alpha;
                ctx.drawImage(img, config.x, config.y, w, h);
                ctx.restore();
            }
        });
    }
}

// Initialize puppet
const puppet = new ShadowPuppet();

// Hand tracking state
let handsDetected = false;
let handLandmarks = { left: null, right: null };

// Mouse control
let draggedTether = null;
let mousePos = new Vector2(0, 0);

canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    // 考虑canvas缩放
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    mousePos.x = (e.clientX - rect.left) * scaleX;
    mousePos.y = (e.clientY - rect.top) * scaleY;

    // 检查是否点击在手附近（扩大点击范围）
    let minDist = 100;
    if (puppet.leftHandWorld) {
        const dist = Math.hypot(puppet.leftHandWorld.x - mousePos.x, puppet.leftHandWorld.y - mousePos.y);
        if (dist < minDist) {
            draggedTether = 'leftHand';
            minDist = dist;
        }
    }
    if (puppet.rightHandWorld) {
        const dist = Math.hypot(puppet.rightHandWorld.x - mousePos.x, puppet.rightHandWorld.y - mousePos.y);
        if (dist < minDist) {
            draggedTether = 'rightHand';
        }
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    mousePos.x = (e.clientX - rect.left) * scaleX;
    mousePos.y = (e.clientY - rect.top) * scaleY;
});

canvas.addEventListener('mouseup', () => {
    draggedTether = null;
});

// MediaPipe Hands setup
function setupHandTracking() {
    const hands = new Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
    });

    hands.setOptions({
        maxNumHands: 2,              // 最多检测2只手
        modelComplexity: 1,          // 模型复杂度：0=lite, 1=full
        minDetectionConfidence: 0.7, // 提高检测置信度
        minTrackingConfidence: 0.7   // 提高追踪置信度
    });

    hands.onResults(onHandsResults);

    const camera = new Camera(video, {
        onFrame: async () => {
            if (video.readyState === 4) {
                await hands.send({ image: video });
            }
        },
        width: 640,
        height: 480
    });

    return camera.start().then(() => {
        statusEl.textContent = '摄像头已启动 - 伸出双手控制（或用鼠标）';
        video.style.display = 'none'; // 隐藏视频，只捕捉手势
    }).catch((err) => {
        console.error('Camera error:', err);
        statusEl.textContent = '摄像头启动失败 - 使用鼠标拖拽控制';
        throw err;
    });
}

function onHandsResults(results) {
    // 绘制手骨架到小窗口
    if (handCtx) {
        handCtx.fillStyle = 'rgba(0,0,0,0.8)';
        handCtx.fillRect(0, 0, 240, 180);
    }

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        handsDetected = false;
        // 没有检测到手时显示提示
        if (handCtx) {
            handCtx.fillStyle = '#666';
            handCtx.font = '14px Arial';
            handCtx.textAlign = 'center';
            handCtx.fillText('伸出双手...', 120, 90);
        }
        return;
    }

    handsDetected = true;

    // 清空之前的识别结果
    handLandmarks = { left: null, right: null };

    // 处理检测到的手
    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const landmarks = results.multiHandLandmarks[i];
        const handedness = results.multiHandedness[i];

        // MediaPipe返回的label是从摄像头视角看的，需要镜像
        // 摄像头看到的"Left"实际是用户的右手
        const isLeftHand = handedness.label === 'Right'; // 镜像后

        if (isLeftHand) {
            handLandmarks.left = landmarks;
        } else {
            handLandmarks.right = landmarks;
        }

        // 绘制手骨架
        if (handCtx) {
            const color = isLeftHand ? '#ff6b6b' : '#4ecdc4'; // 左手红色，右手青色
            drawHandSkeleton(handCtx, landmarks, color);
        }
    }

    // 更新tether位置 - 使用食指尖
    if (handLandmarks.left) {
        const indexTip = handLandmarks.left[8]; // 食指尖
        // 镜像翻转X坐标
        const x = (1 - indexTip.x) * canvas.width;
        const y = indexTip.y * canvas.height;
        puppet.tethers.leftHand.updateTarget(x, y);
    }

    if (handLandmarks.right) {
        const indexTip = handLandmarks.right[8]; // 食指尖
        // 镜像翻转X坐标
        const x = (1 - indexTip.x) * canvas.width;
        const y = indexTip.y * canvas.height;
        puppet.tethers.rightHand.updateTarget(x, y);
    }
}

// 绘制手骨架
function drawHandSkeleton(ctx, landmarks, color) {
    const w = 240, h = 180;

    // 手指连接关系
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],       // 拇指
        [0, 5], [5, 6], [6, 7], [7, 8],       // 食指
        [0, 9], [9, 10], [10, 11], [11, 12],  // 中指
        [0, 13], [13, 14], [14, 15], [15, 16], // 无名指
        [0, 17], [17, 18], [18, 19], [19, 20], // 小指
        [5, 9], [9, 13], [13, 17]              // 手掌
    ];

    // 绘制连接线
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    connections.forEach(([i, j]) => {
        const p1 = landmarks[i];
        const p2 = landmarks[j];
        ctx.beginPath();
        ctx.moveTo((1 - p1.x) * w, p1.y * h); // 镜像X
        ctx.lineTo((1 - p2.x) * w, p2.y * h);
        ctx.stroke();
    });

    // 绘制关节点
    ctx.fillStyle = color;
    landmarks.forEach((p, i) => {
        const x = (1 - p.x) * w; // 镜像X
        const y = p.y * h;
        ctx.beginPath();
        ctx.arc(x, y, i === 8 ? 6 : 3, 0, Math.PI * 2); // 食指尖大一点
        ctx.fill();
    });
}

// Animation loop
function drawBackground() {
    // 更接近素材的米黄色背景
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#f5ead8'); // 更浅的米黄色
    gradient.addColorStop(1, '#ebe0c8'); // 稍深的米黄色
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Add texture noise
    ctx.fillStyle = 'rgba(139, 115, 85, 0.02)'; // 减少噪点强度
    for (let i = 0; i < 500; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        ctx.fillRect(x, y, 1, 1);
    }

    // Top beam
    ctx.fillStyle = '#8b7355';
    ctx.fillRect(0, 40, canvas.width, 20);

    // Ground line at bottom
    const groundY = canvas.height - 10; // 地面在画布底部
    ctx.strokeStyle = 'rgba(139, 115, 85, 0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(canvas.width, groundY);
    ctx.stroke();
}

function animate() {
    drawBackground();

    // 鼠标控制（当拖拽时优先使用鼠标）
    if (draggedTether) {
        puppet.tethers[draggedTether].updateTarget(mousePos.x, mousePos.y);
    }
    // 如果没有拖拽且没有检测到手，保持初始姿势
    else if (!handsDetected) {
        // 不更新tether目标，让手臂保持当前位置
        // 或者可以让tether缓慢回到初始位置
    }

    puppet.update();
    puppet.draw(ctx);

    requestAnimationFrame(animate);
}

// Camera access is requested only after the visitor chooses hand control.
function loadTrackingScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

const cameraButton = document.getElementById('enable-camera');
cameraButton.addEventListener('click', async () => {
    cameraButton.disabled = true;
    statusEl.textContent = '正在加载手势识别…';
    try {
        await loadTrackingScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js');
        await loadTrackingScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
        await setupHandTracking();
        cameraButton.hidden = true;
    } catch (error) {
        console.error('Hand tracking unavailable:', error);
        statusEl.textContent = '手势识别加载失败，仍可用鼠标拖动影人双手';
        cameraButton.disabled = false;
    }
});

animate();
