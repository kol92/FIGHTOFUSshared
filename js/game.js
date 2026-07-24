(function(){
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  // offscreen buffer used to tint a sprite white on hit-flash without bleeding onto the background
  const flashCanvas = document.createElement('canvas');
  const flashCtx = flashCanvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const GROUND_Y = H - 70;
  const GRAVITY = 0.7;
  const JUMP_V = -15;
  const MOVE_SPEED = 4.2;
  const ROUND_TIME = 60;
  // Global on-screen size multiplier for EVERY fighter's rendered sprite (all poses/clips/ultimate/
  // enter). Purely visual — hitboxes/pushboxes are unaffected — so it just makes all four characters
  // bigger while keeping their relative proportions. Applied once in drawFighter's poseScale().
  const GLOBAL_FIGHTER_SCALE = 1.15;
  // --- asset manifest (paths from js/assets.js) ---
  const A = window.ASSETS;
  const SPRITE_DATA = A.sprites;
  const SPRITE_DATA_KRISZ_SPECIAL = A.special.krisz;
  const SPRITE_DATA_TOMI_SPECIAL  = A.special.tomi;
  const SPRITE_DATA_LACI_SPECIAL  = A.special.laci;
  const SPRITE_DATA_BARNA_SPECIAL = A.special.barna;
  const SPRITE_DATA_ULTIMATES = A.ultimates;
  const SPRITE_DATA_ENTER     = A.enter;
  const SPRITE_DATA_COMBAT2   = A.combat2;
  const SPRITE_DATA_COMBAT2_SPECIAL = A.combat2_special;
  const SPRITE_DATA_CLIPS     = A.clips;
  const UI_ASSETS  = A.ui;
  const STAGE_DATA = A.stages;
  

  
  
  
  


  // Krisz "Ultimate" pose sequence — 10 frames from krisz_ultimate.png, played back to back
  // by the UltimateManager. Keyed by charId so future characters just add their own entry here.
  

  

  
  const stageImages = {};
  // Lazily build a stage's background Image only when that stage is actually needed
  // (chosen for a match — see enterVsScreen / drawPhotoBg). Idempotent.
  function ensureStageLoaded(key){
    if (!STAGE_DATA[key] || stageImages[key]) return;
    const img = new Image();
    img.src = STAGE_DATA[key];
    stageImages[key] = img;
  }

  const SPRITE_POSES = ["idle","walk","run","jump","block","punch","kick","hit","win","lose"];
  const sprites = { krisz: {}, tomi: {}, laci: {}, barna: {}, krisz_special: {}, tomi_special: {}, laci_special: {}, barna_special: {}, ultimates: {}, enter: {}, combat2: {}, combat2_special: {}, clips: {} };
  // refresh whichever menu screen is currently showing portraits once a sprite image finishes
  // decoding — data-URIs are basically instant, this is just a safety net against draw-before-ready
  function onSpriteReady(){
    if (gameState === 'CHARACTER_SELECT') renderCharGrid();
    else if (gameState === 'VS_SCREEN') renderVsScreen();
  }
  // ---------- LAZY SPRITE LOADING ----------
  // Sprites used to be built eagerly at startup (all ~450 Images at once). Now only the four
  // idle sprites the menus draw are loaded up front; each fighter's full sprite set is built
  // on demand the first time that fighter is needed (ensureFighterLoaded, called from
  // enterVsScreen and, defensively, from drawFighter). Every canvas draw already guards on
  // img.complete/naturalWidth, so a sprite still decoding just isn't drawn for a frame or two.
  //
  // Eager: only each character's idle sprite. drawPortrait (character-select grid + VS screen)
  // reads sprites[charDef.spriteKey].idle directly; Barna's SPRITE_DATA holds only idle (its
  // full moveset lives in the clip system), so this covers every portrait.
  for (const person of ["krisz","tomi","laci","barna"]){
    const img = new Image();
    img.onload = onSpriteReady;
    img.src = SPRITE_DATA[person].idle;
    sprites[person].idle = img;
  }

  const loadedFighters = new Set();
  // Build any not-yet-created Images for the keys in srcMap into dest (skips ones already made).
  function loadImageMap(dest, srcMap){
    for (const k in srcMap){
      if (dest[k]) continue;
      const img = new Image();
      img.onload = onSpriteReady;
      img.src = srcMap[k];
      dest[k] = img;
    }
  }
  // Construct a character's full sprite set on demand: base poses, Berserk alt-art, ultimate,
  // enter, combat2 (+ its berserk variant) and the multi-frame animation clips. Idempotent.
  function ensureFighterLoaded(id){
    if (!id || loadedFighters.has(id)) return;
    loadedFighters.add(id);
    if (SPRITE_DATA[id])          loadImageMap(sprites[id], SPRITE_DATA[id]);
    // Berserk alt-art (the old "special" sprite sets) is retired — Berserk is now a meter-gated MOVE,
    // not a timed alt-art buff. We no longer load sprites[id+'_special'] / combat2_special; drawFighter's
    // useSpecialArt branch is dead (f.berserkActive stays 0), so these sets are simply never consulted.
    if (SPRITE_DATA_ULTIMATES[id]){ sprites.ultimates[id] = sprites.ultimates[id] || {}; loadImageMap(sprites.ultimates[id], SPRITE_DATA_ULTIMATES[id]); }
    if (SPRITE_DATA_ENTER[id]){     sprites.enter[id]     = sprites.enter[id]     || {}; loadImageMap(sprites.enter[id], SPRITE_DATA_ENTER[id]); }
    if (SPRITE_DATA_COMBAT2[id]){   sprites.combat2[id]   = sprites.combat2[id]   || {}; loadImageMap(sprites.combat2[id], SPRITE_DATA_COMBAT2[id]); }
    if (SPRITE_DATA_CLIPS[id]){
      sprites.clips[id] = sprites.clips[id] || {};
      for (const pose in SPRITE_DATA_CLIPS[id]){
        if (sprites.clips[id][pose]) continue;
        sprites.clips[id][pose] = SPRITE_DATA_CLIPS[id][pose].map(src => {
          const img = new Image();
          img.onload = onSpriteReady;
          img.src = src;
          return img;
        });
      }
    }
    wireUltimateClip(id); // fold the ultimate poses into the clip system (see its definition)
  }
  // Berserk alt-art: each character has its own full 10-pose "in Berserk" sprite set (Krisz wields the
  // STOP sign, Tomi wears sunglasses), swapped in by drawFighter while f.berserkActive > 0. Adding a
  // new character's Berserk look later is just one more entry in this map + its own SPRITE_DATA block.
  // Berserk alt-art: each character has its own full 10-pose "in Berserk" sprite set (Krisz wields
  // the STOP sign, Tomi wears sunglasses), swapped in by drawFighter while f.berserkActive > 0.
  // Built on demand by ensureFighterLoaded (into sprites[id + '_special']).
  const BERSERK_SPRITE_DATA = { krisz: SPRITE_DATA_KRISZ_SPECIAL, tomi: SPRITE_DATA_TOMI_SPECIAL, laci: SPRITE_DATA_LACI_SPECIAL, barna: SPRITE_DATA_BARNA_SPECIAL };

  // ---------- GENERIC PER-CHARACTER ANIMATION CLIP SYSTEM ----------
  // A "clip" is a named, multi-frame animation (idle/walk/backwalk/run/jump/punch/kick/sweep/block/
  // crouch/crouchBlock/hit/knockdown/getUp/throw/beingThrown/taunt/win/lose) -- unlike every sprite set
  // above (one static image per pose), SPRITE_DATA_CLIPS[charId][poseName] is an ARRAY of frame images,
  // and CLIP_CONFIG[charId][poseName] says how to play them back (loop or one-shot, each frame's own
  // duration in ms, each frame's own calibrated anchor). This is what lets a character's whole moveset
  // come from a full sprite-sheet-per-animation shoot (like Barna's) instead of one image per pose.
  // Completely opt-in per character/per-pose, same philosophy as every other *_SPECIAL/*_ULTIMATES/
  // *_ENTER block above: a character with no CLIP_CONFIG entry for a given pose name simply falls
  // through to the older per-character systems (Berserk special art, then plain Combat2 art, then the
  // base SPRITE_DATA), so adding Tomi/Krisz/Laci's own future full-animation sets later is purely a
  // data addition here -- drawFighter/pickPose never need another special case.

const CLIP_CONFIG = {
  krisz: {
    berserk: { loop: false, frameMs: [120,140,130,130,130,110,120,160],
      anchors: [{x:163.7,y:412.0},{x:163.7,y:400.0},{x:163.7,y:411.0},{x:163.7,y:411.0},{x:163.7,y:381.0},{x:163.7,y:380.0},{x:163.7,y:379.0},{x:163.7,y:390.0}],
      scale: 0.435 },
    idle: { loop: true, frameMs: [150,150,150,150,150,150,150,150], anchors: [{x:226.3,y:475.0},{x:192.0,y:475.0},{x:155.8,y:475.0},{x:117.1,y:475.0},{x:224.0,y:475.0},{x:193.4,y:475.0},{x:157.7,y:475.0},{x:120.9,y:475.0}], scale: 0.3582 },
    walk: { loop: true, frameMs: [105,105,105,105,105,105,105,105], anchors: [{x:209.2,y:481.0},{x:173.1,y:483.0},{x:151.7,y:482.0},{x:120.8,y:487.0},{x:201.3,y:463.0},{x:175.7,y:458.0},{x:150.5,y:466.0},{x:132.0,y:468.0}], scale: 0.3684 },
    run: { loop: true, frameMs: [85,85,85,85,85,85,85,85], anchors: [{x:240.2,y:458.0},{x:213.2,y:463.0},{x:160.4,y:442.0},{x:165.2,y:457.0},{x:204.4,y:383.0},{x:211.3,y:402.0},{x:157.5,y:374.0},{x:152.3,y:409.0}], scale: 0.4138 },
    backwalk: { loop: true, frameMs: [110,110,110,110,110,110,110,110], anchors: [{x:170.5,y:442.0},{x:149.9,y:442.0},{x:144.5,y:442.0},{x:117.2,y:442.0},{x:162.3,y:424.0},{x:136.1,y:424.0},{x:139.5,y:424.0},{x:96.5,y:424.0}], scale: 0.3962 },
    jump: { loop: false, frameMs: [90,90,90,90,90,90,90,90], anchors: [{x:194.8,y:464.0},{x:164.2,y:462.0},{x:139.6,y:461.0},{x:122.5,y:389.0},{x:210.3,y:290.0},{x:164.9,y:308.0},{x:159.5,y:396.0},{x:136.9,y:453.0}], scale: 0.5076 },
    crouch: { loop: false, frameMs: [60,60,60,60,60,60,60,60], anchors: [{x:170.1,y:460.0},{x:158.5,y:461.0},{x:160.8,y:460.0},{x:139.3,y:459.0},{x:151.5,y:411.0},{x:143.1,y:413.0},{x:142.7,y:415.0},{x:122.7,y:414.0}], scale: 0.3582 },
    block: { loop: false, frameMs: [70,70,70,70,70,70], anchors: [{x:277.1,y:469.0},{x:230.8,y:469.0},{x:126.2,y:469.0},{x:262.4,y:453.0},{x:209.7,y:455.0},{x:136.2,y:455.0}], scale: 0.366 },
    crouchBlock: { loop: false, frameMs: [70,70,70,70,70,70], anchors: [{x:254.6,y:433.0},{x:247.6,y:433.0},{x:157.0,y:433.0},{x:253.9,y:353.0},{x:210.8,y:353.0},{x:188.8,y:352.0}], scale: 0.3582 },
    hit: { loop: false, frameMs: [70,70,70,70,70,70], anchors: [{x:352.3,y:455.0},{x:225.3,y:455.0},{x:109.0,y:455.0},{x:357.8,y:411.0},{x:243.1,y:424.0},{x:111.8,y:423.0}], scale: 0.3981 },
    sweep: { loop: false, frameMs: [72,72,72,72,72,72,72,72], anchors: [{x:185.0,y:464.0},{x:185.0,y:457.0},{x:185.0,y:432.0},{x:185.0,y:437.0},{x:185.0,y:345.0},{x:185.0,y:354.0},{x:185.0,y:404.0},{x:185.0,y:409.0}], scale: 0.3898 },
    taunt: { loop: false, frameMs: [150,150,150,150,150,150,150,150], anchors: [{x:151.2,y:473.0},{x:133.3,y:473.0},{x:133.9,y:473.0},{x:141.3,y:473.0},{x:157.6,y:431.0},{x:143.8,y:431.0},{x:125.5,y:431.0},{x:140.7,y:431.0}], scale: 0.3953 },
    getUp: { loop: false, frameMs: [85,85,85,85,85,85,85,85], anchors: [{x:135.7,y:452.0},{x:173.6,y:450.0},{x:142.6,y:453.0},{x:123.6,y:456.0},{x:140.2,y:384.0},{x:115.1,y:384.0},{x:128.5,y:388.0},{x:120.5,y:388.0}], scale: 0.3582 },
    knockdown: { loop: false, frameMs: [95,95,95,95,95,95,95,95], anchors: [{x:155.7,y:355.0},{x:139.9,y:354.0},{x:145.8,y:351.0},{x:134.1,y:329.0},{x:144.4,y:216.0},{x:147.2,y:194.0},{x:140.3,y:205.0},{x:152.2,y:210.0}], scale: 0.4773 },
    lose: { loop: false, frameMs: [150,150,150,150,150,150,150,150], anchors: [{x:153.2,y:446.0},{x:126.0,y:446.0},{x:126.8,y:446.0},{x:145.1,y:446.0},{x:158.5,y:373.0},{x:150.6,y:378.0},{x:150.5,y:380.0},{x:154.4,y:383.0}], scale: 0.3792 },
    win: { loop: false, frameMs: [150,150,150,150,150,150,150,150], anchors: [{x:182.8,y:499.0},{x:163.5,y:499.0},{x:143.9,y:499.0},{x:124.0,y:499.0},{x:196.7,y:479.0},{x:168.1,y:477.0},{x:158.3,y:478.0},{x:126.6,y:478.0}], scale: 0.4 },
    punch: { loop: false, frameMs: [42,42,42,42], anchors: [{x:132.9,y:385.0},{x:132.9,y:384.0},{x:132.9,y:385.0},{x:132.9,y:384.0}], scale: 0.48 },
    kick: { loop: false, frameMs: [52,52,52,52], anchors: [{x:141.3,y:433.0},{x:141.3,y:432.0},{x:141.3,y:433.0},{x:141.3,y:433.0}], scale: 0.4746 },
    throw: { loop: false, frameMs: [55,55,55,55,55,55,55,55,55,55], anchors: [{x:139.3,y:325.0},{x:154.8,y:326.0},{x:123.7,y:328.0},{x:118.0,y:328.0},{x:92.1,y:328.0},{x:137.6,y:318.0},{x:183.4,y:320.0},{x:170.9,y:321.0},{x:155.7,y:322.0},{x:132.6,y:322.0}], scale: 0.3582 },
    beingThrown: { loop: false, frameMs: [58,58,58,58,58,58,58,58,58,58], anchors: [{x:156.8,y:337.0},{x:122.6,y:337.0},{x:129.6,y:338.0},{x:150.0,y:339.0},{x:119.1,y:343.0},{x:133.0,y:247.0},{x:156.7,y:254.0},{x:144.3,y:290.0},{x:169.4,y:284.0},{x:173.3,y:285.0}], scale: 0.3582 },
    punch1: { loop: false, frameMs: [42,42,42,42], anchors: [{x:132.9,y:385.0},{x:132.9,y:384.0},{x:132.9,y:385.0},{x:132.9,y:384.0}], scale: 0.48 },
    punch2: { loop: false, frameMs: [42,42,42,42], anchors: [{x:132.9,y:384.0},{x:132.9,y:383.0},{x:132.9,y:352.0},{x:132.9,y:352.0}], scale: 0.48 },
    punch3: { loop: false, frameMs: [46,46,46,46], anchors: [{x:132.9,y:352.0},{x:132.9,y:351.0},{x:132.9,y:352.0},{x:132.9,y:351.0}], scale: 0.48 },
    kick1: { loop: false, frameMs: [52,52,52,52], anchors: [{x:141.3,y:433.0},{x:141.3,y:432.0},{x:141.3,y:433.0},{x:141.3,y:433.0}], scale: 0.4746 },
    kick2: { loop: false, frameMs: [52,52,52,52], anchors: [{x:141.3,y:434.0},{x:141.3,y:333.0},{x:141.3,y:389.0},{x:141.3,y:395.0}], scale: 0.4746 },
    kick3: { loop: false, frameMs: [58,58,58,58], anchors: [{x:141.3,y:394.0},{x:141.3,y:397.0},{x:141.3,y:393.0},{x:141.3,y:396.0}], scale: 0.4746 },
  },
  tomi: {
    idle: { loop: true, frameMs: [150,150,150,150,150,150,150,150], anchors: [{x:106.0,y:424.0},{x:106.7,y:422.0},{x:106.5,y:422.0},{x:107.4,y:422.0},{x:105.6,y:423.0},{x:104.6,y:423.0},{x:103.2,y:423.0},{x:104.5,y:423.0}], scale: 0.4951 },
    walk: { loop: true, frameMs: [90,90,90,90,90,90,90,90], anchors: [{x:84.1,y:496.0},{x:71.6,y:494.0},{x:57.4,y:494.0},{x:48.9,y:497.0},{x:55.9,y:494.0},{x:35.0,y:496.0},{x:28.8,y:494.0},{x:49.9,y:494.0}], scale: 0.423 },
    backwalk: { loop: true, frameMs: [90,90,90,90,90,90,90,90], anchors: [{x:107.4,y:482.0},{x:98.0,y:481.0},{x:104.8,y:465.0},{x:116.9,y:465.0},{x:110.2,y:461.0},{x:84.8,y:477.0},{x:94.7,y:479.0},{x:107.3,y:479.0}], scale: 0.4419 },
    run: { loop: true, frameMs: [70,70,70,70,70,70,70,70], anchors: [{x:159.0,y:390.0},{x:178.8,y:395.0},{x:148.5,y:400.0},{x:170.5,y:385.0},{x:188.6,y:386.0},{x:155.1,y:406.0},{x:147.0,y:409.0},{x:175.8,y:395.0}], scale: 0.5289 },
    jump: { loop: false, frameMs: [100,100,100,100,100,100,100,100], anchors: [{x:86.0,y:324.0},{x:82.8,y:333.0},{x:18.9,y:418.0},{x:51.2,y:374.0},{x:70.3,y:346.0},{x:57.3,y:308.0},{x:70.7,y:352.0},{x:86.6,y:303.0}], scale: 0.5007 },
    punch: { loop: false, frameMs: [42,42,42,42,42,42,42,42], anchors: [{x:111.2,y:444.0},{x:131.7,y:403.0},{x:113.9,y:403.0},{x:152.2,y:371.0},{x:143.8,y:390.0},{x:111.1,y:400.0},{x:107.5,y:409.0},{x:107.6,y:413.0}], scale: 0.4714 },
    kick: { loop: false, frameMs: [56,56,56,56,56,56,56,56], anchors: [{x:107.7,y:438.0},{x:71.9,y:424.0},{x:82.5,y:428.0},{x:108.0,y:411.0},{x:105.3,y:413.0},{x:94.3,y:422.0},{x:107.4,y:424.0},{x:105.2,y:424.0}], scale: 0.4778 },
    sweep: { loop: false, frameMs: [79,79,79,79,79,79,79,79], anchors: [{x:123.6,y:405.0},{x:101.5,y:298.0},{x:153.3,y:255.0},{x:147.4,y:258.0},{x:159.1,y:256.0},{x:80.5,y:242.0},{x:116.2,y:370.0},{x:114.5,y:420.0}], scale: 0.5168 },
    block: { loop: false, frameMs: [110,110,110,110], anchors: [{x:109.7,y:418.0},{x:109.0,y:412.0},{x:110.6,y:413.0},{x:110.1,y:417.0}], scale: 0.5007 },
    crouch: { loop: false, frameMs: [90,90,90,90,90], anchors: [{x:106.6,y:419.0},{x:110.2,y:395.0},{x:135.0,y:321.0},{x:176.0,y:286.0},{x:169.1,y:259.0}], scale: 0.4996 },
    crouchBlock: { loop: false, frameMs: [90,90,90], anchors: [{x:235.2,y:393.0},{x:182.8,y:357.0},{x:227.9,y:368.0}], scale: 0.3158 },
    hit: { loop: false, frameMs: [55,55,55,55,55,55,55,55], anchors: [{x:132.2,y:372.0},{x:130.3,y:375.0},{x:233.6,y:334.0},{x:147.4,y:334.0},{x:123.4,y:367.0},{x:109.4,y:415.0},{x:109.4,y:416.0},{x:109.5,y:416.0}], scale: 0.5031 },
    knockdown: { loop: false, frameMs: [112,112,112,112,112,112,112,112], anchors: [{x:137.1,y:379.0},{x:204.3,y:328.0},{x:225.2,y:257.0},{x:130.0,y:220.0},{x:130.7,y:199.0},{x:147.1,y:137.0},{x:151.3,y:134.0},{x:162.8,y:108.0}], scale: 0.5522 },
    getUp: { loop: false, frameMs: [70,70,70,70,70,70,70,70], anchors: [{x:125.2,y:163.0},{x:158.2,y:205.0},{x:182.9,y:228.0},{x:111.9,y:287.0},{x:135.2,y:317.0},{x:91.5,y:354.0},{x:98.4,y:378.0},{x:105.6,y:379.0}], scale: 0.5522 },
    throw: { loop: false, frameMs: [57,57,57,57,57,57,57,57,57,57], anchors: [{x:133.5,y:375.0},{x:138.1,y:366.0},{x:110.2,y:378.0},{x:120.6,y:367.0},{x:116.6,y:363.0},{x:132.0,y:321.0},{x:174.0,y:336.0},{x:134.0,y:303.0},{x:107.8,y:355.0},{x:106.8,y:358.0}], scale: 0.5581 },
    beingThrown: { loop: false, frameMs: [85,85,85,85,85,85,85,85,85,85], anchors: [{x:117.5,y:272.0},{x:116.8,y:253.0},{x:107.4,y:331.0},{x:102.0,y:328.0},{x:160.2,y:313.0},{x:117.9,y:238.0},{x:116.4,y:177.0},{x:135.3,y:112.0},{x:135.3,y:220.0},{x:97.0,y:350.0}], scale: 0.598 },
    taunt: { loop: false, frameMs: [130,130,130,130,130,130,130,130,130,130], anchors: [{x:95.4,y:413.0},{x:88.7,y:408.0},{x:91.2,y:413.0},{x:108.5,y:393.0},{x:104.8,y:401.0},{x:77.0,y:395.0},{x:101.8,y:390.0},{x:104.3,y:392.0},{x:88.0,y:415.0},{x:99.4,y:402.0}], scale: 0.5068 },
    win: { loop: false, frameMs: [140,140,150,160,120,380,320,420], anchors: [{x:91.5,y:426.0},{x:82.6,y:437.0},{x:99.2,y:417.0},{x:72.5,y:428.0},{x:81.5,y:430.0},{x:88.4,y:454.0},{x:93.8,y:452.0},{x:88.1,y:452.0}], scale: 0.4913 }, // frissítve: 8 kockán áll meg (szelfizés), a 9-10. kocka nem játszódik le
    lose: { loop: false, frameMs: [140,140,140,140,140,140,140,140], anchors: [{x:167.9,y:447.0},{x:208.0,y:407.0},{x:155.9,y:316.0},{x:105.4,y:284.0},{x:97.8,y:317.0},{x:98.1,y:293.0},{x:96.8,y:270.0},{x:97.7,y:284.0}], scale: 0.4683 },
    punch1: { loop: false, frameMs: [42,42,42,42], anchors: [{x:165.6,y:313.0},{x:165.6,y:313.0},{x:165.6,y:313.0},{x:165.6,y:313.0}], scale: 0.64 },
    punch2: { loop: false, frameMs: [42,42,42,42], anchors: [{x:165.6,y:313.0},{x:165.6,y:313.0},{x:165.6,y:313.0},{x:165.6,y:313.0}], scale: 0.64 },
    punch3: { loop: false, frameMs: [42,42,42,42], anchors: [{x:165.6,y:313.0},{x:165.6,y:313.0},{x:165.6,y:313.0},{x:165.6,y:313.0}], scale: 0.64 },
    kick1: { loop: false, frameMs: [56,56,56,56], anchors: [{x:133.9,y:427.0},{x:133.9,y:427.0},{x:133.9,y:427.0},{x:133.9,y:427.0}], scale: 0.5442 },
    kick2: { loop: false, frameMs: [56,56,56,56], anchors: [{x:133.9,y:427.0},{x:133.9,y:427.0},{x:133.9,y:427.0},{x:133.9,y:427.0}], scale: 0.5442 },
    kick3: { loop: false, frameMs: [56,56,56,56], anchors: [{x:133.9,y:427.0},{x:133.9,y:427.0},{x:133.9,y:427.0},{x:133.9,y:427.0}], scale: 0.5442 },
  },
  barna: {
    idle: { loop: true, frameMs: [150,150,150,150,150,150,150,150], anchors: [{x:134.8,y:468.0},{x:131.9,y:467.0},{x:135.5,y:471.0},{x:125.2,y:468.0},{x:137.8,y:460.0},{x:136.5,y:455.0},{x:140.2,y:456.0},{x:131.2,y:456.0}], scale: 0.3934 },
    walk: { loop: true, frameMs: [90,90,90,90,90,90,90,90], anchors: [{x:136.3,y:481.0},{x:154.1,y:482.0},{x:151.9,y:478.0},{x:134.3,y:483.0},{x:153.5,y:480.0},{x:142.3,y:483.0},{x:143.8,y:481.0},{x:151.6,y:482.0}], scale: 0.3782 },
    backwalk: { loop: true, frameMs: [90,90,90,90,90,90,90,90], anchors: [{x:80.8,y:370.0},{x:100.8,y:371.0},{x:111.4,y:370.0},{x:107.7,y:370.0},{x:105.3,y:373.0},{x:101.5,y:374.0},{x:101.4,y:374.0},{x:96.2,y:374.0}], scale: 0.4892 },
    run: { loop: true, frameMs: [70,70,70,70,70,70,70,70], anchors: [{x:124.6,y:392.0},{x:160.0,y:393.0},{x:143.8,y:373.0},{x:151.2,y:366.0},{x:146.0,y:385.0},{x:166.0,y:378.0},{x:151.6,y:369.0},{x:180.7,y:397.0}], scale: 0.4769 },
    jump: { loop: true, frameMs: [100,100,100,100,100,100,100,100], anchors: [{x:108.6,y:357.0},{x:99.2,y:303.0},{x:53.1,y:413.0},{x:98.7,y:379.0},{x:101.0,y:372.0},{x:92.4,y:358.0},{x:146.2,y:392.0},{x:118.3,y:351.0}], scale: 0.4978 },
    punch: { loop: false, frameMs: [42,42,42,42,42,42,42,42], anchors: [{x:138.7,y:385.0},{x:126.2,y:385.0},{x:131.6,y:384.0},{x:136.3,y:382.0},{x:146.9,y:377.0},{x:127.6,y:377.0},{x:128.9,y:382.0},{x:119.7,y:383.0}], scale: 0.4766 },
    kick: { loop: false, frameMs: [56,56,56,56,56,56,56,56], anchors: [{x:107.8,y:381.0},{x:110.9,y:369.0},{x:103.2,y:406.0},{x:88.8,y:376.0},{x:103.3,y:367.0},{x:104.3,y:371.0},{x:95.0,y:392.0},{x:101.2,y:372.0}], scale: 0.4799 },
    sweep: { loop: false, frameMs: [79,79,79,79,79,79,79,79], anchors: [{x:118.3,y:363.0},{x:108.4,y:288.0},{x:139.9,y:274.0},{x:132.2,y:246.0},{x:119.8,y:235.0},{x:87.9,y:283.0},{x:117.2,y:369.0},{x:112.5,y:368.0}], scale: 0.4932 },
    block: { loop: false, frameMs: [110,110,110,110], anchors: [{x:123.6,y:421.0},{x:140.8,y:420.0},{x:140.0,y:420.0},{x:135.4,y:419.0}], scale: 0.4333 },
    crouch: { loop: false, frameMs: [90,90,90,90], anchors: [{x:121.0,y:415.0},{x:114.7,y:370.0},{x:124.7,y:308.0},{x:93.3,y:284.0}], scale: 0.4386 },
    // Frames 4-6 of the source sheet are the guard RELAXING back out (hands coming down, looking away
    // -- not a defensive pose), so the clip -- like Block and Crouch -- is trimmed to frames 1-3 (rise
    // into guard, hold on frame 3's peak: both fists tucked tight against the face) and set to
    // non-looping, so it settles on that held guard frame for as long as Down+Block stays pressed,
    // instead of endlessly cycling through the relax-and-reguard motion.
    crouchBlock: { loop: false, frameMs: [90,90,90], anchors: [{x:150.1,y:327.0},{x:136.3,y:331.0},{x:146.5,y:329.0}], scale: 0.4386 },
    hit: { loop: false, frameMs: [55,55,55,55,55,55], anchors: [{x:167.3,y:334.0},{x:187.9,y:331.0},{x:189.8,y:321.0},{x:133.9,y:351.0},{x:99.9,y:356.0},{x:100.3,y:359.0}], scale: 0.507 },
    knockdown: { loop: false, frameMs: [112,112,112,112,112,112,112,112], anchors: [{x:106.9,y:374.0},{x:128.0,y:370.0},{x:130.5,y:297.0},{x:148.4,y:256.0},{x:136.8,y:193.0},{x:161.1,y:133.0},{x:162.6,y:100.0},{x:170.7,y:104.0}], scale: 0.4866 },
    getUp: { loop: false, frameMs: [70,70,70,70,70,70,70,70], anchors: [{x:145.1,y:183.0},{x:144.3,y:208.0},{x:125.9,y:287.0},{x:95.0,y:313.0},{x:127.2,y:275.0},{x:113.3,y:377.0},{x:122.2,y:416.0},{x:120.9,y:398.0}], scale: 0.4375 },
    throw: { loop: false, frameMs: [57,57,57,57,57,57,57,57,57,57], anchors: [{x:100.4,y:361.0},{x:153.2,y:334.0},{x:122.3,y:331.0},{x:122.0,y:293.0},{x:125.2,y:313.0},{x:141.0,y:331.0},{x:145.5,y:300.0},{x:148.4,y:334.0},{x:123.5,y:350.0},{x:99.6,y:345.0}], scale: 0.5042 },
    beingThrown: { loop: false, frameMs: [85,85,85,85,85,85,85,85], anchors: [{x:158.9,y:277.0},{x:152.7,y:257.0},{x:124.5,y:322.0},{x:96.8,y:302.0},{x:94.9,y:307.0},{x:91.8,y:288.0},{x:119.8,y:231.0},{x:157.0,y:124.0}], scale: 0.5652 },
    taunt: { loop: false, frameMs: [130,130,130,130,130,130,130,130], anchors: [{x:111.3,y:420.0},{x:118.2,y:420.0},{x:109.4,y:420.0},{x:111.2,y:423.0},{x:111.3,y:415.0},{x:111.3,y:417.0},{x:107.6,y:423.0},{x:109.6,y:419.0}], scale: 0.4337 },
    win: { loop: false, frameMs: [130,140,160,170,170,170,160,160,220,450], anchors: [{x:83.8,y:336.0},{x:76.0,y:356.0},{x:75.0,y:353.0},{x:80.5,y:351.0},{x:74.7,y:351.0},{x:75.6,y:353.0},{x:77.4,y:356.0},{x:74.4,y:354.0},{x:88.2,y:358.0},{x:107.1,y:377.0}], scale: 0.5134 },
    lose: { loop: false, frameMs: [140,140,140,140,140,140,140,140], anchors: [{x:145.2,y:373.0},{x:209.2,y:360.0},{x:138.3,y:300.0},{x:93.8,y:280.0},{x:94.0,y:292.0},{x:91.5,y:281.0},{x:88.9,y:261.0},{x:83.4,y:278.0}], scale: 0.4879 },
    punch1: { loop: false, frameMs: [42,42,42,42], anchors: [{x:127.1,y:400.0},{x:127.1,y:400.0},{x:127.1,y:400.0},{x:127.1,y:400.0}], scale: 0.49 },
    punch2: { loop: false, frameMs: [42,42,42,42], anchors: [{x:127.1,y:400.0},{x:127.1,y:400.0},{x:127.1,y:400.0},{x:127.1,y:400.0}], scale: 0.49 },
    punch3: { loop: false, frameMs: [42,42,42,42], anchors: [{x:127.1,y:400.0},{x:127.1,y:400.0},{x:127.1,y:400.0},{x:127.1,y:400.0}], scale: 0.49 },
    kick1: { loop: false, frameMs: [56,56,56,56], anchors: [{x:134.1,y:418.0},{x:134.1,y:418.0},{x:134.1,y:418.0},{x:134.1,y:418.0}], scale: 0.48 },
    kick2: { loop: false, frameMs: [56,56,56,56], anchors: [{x:134.1,y:418.0},{x:134.1,y:418.0},{x:134.1,y:418.0},{x:134.1,y:418.0}], scale: 0.48 },
    kick3: { loop: false, frameMs: [56,56,56,56], anchors: [{x:134.1,y:418.0},{x:134.1,y:418.0},{x:134.1,y:418.0},{x:134.1,y:418.0}], scale: 0.48 },
  },
};

  // ---------- CHARACTER ROSTER (data-driven, ready to grow past 2 characters) ----------
  // portraitCrop is a fractional box (0..1 of the IDLE sprite's own width/height) framing the
  // head + upper shoulders for the character-select portrait; tuned by hand per character since
  // Krisz/Tomi have different proportions and the sprite art isn't on a shared fixed canvas size.
  const CHARACTERS = [
    { id: 'krisz', name: 'KRISZ', enabled: true, spriteKey: 'krisz',
      portraitCrop: { x: 77/690, y: 0, w: 562/690, h: 611/1222 } },
    { id: 'tomi', name: 'TOMI', enabled: true, spriteKey: 'tomi',
      portraitCrop: { x: 34/206, y: 0, w: 150/206, h: 170/424 } },
    { id: 'laci', name: 'LACI', enabled: true, spriteKey: 'laci',
      portraitCrop: { x: 15/178, y: 0, w: 148/178, h: 175/310 } },
    { id: 'barna', name: 'BARNA', enabled: true, spriteKey: 'barna',
      portraitCrop: { x: 20/267, y: 0, w: 227/267, h: 257/468 } },
    // 20 zárolt "COMING SOON" slot (6x4-es rács a 4 valódi karakterrel együtt) -- új karakter
    // hozzáadásához csak cseréld le az egyik zárolt bejegyzést egy valódi definícióra
    // (id/name/enabled/spriteKey/portraitCrop), a rács és a kurzor-navigáció automatikusan követi
    ...Array.from({ length: 20 }, (_, i) => ({ id: 'locked' + (i + 1), name: '', enabled: false })),
  ];
  // Karakterválasztó preview panel adatai: statok (1-10 skálán, egyelőre csak vizuális jelzés,
  // NEM hat a harcrendszerre) és az Ultimate megjelenített neve karakterenként.
  const CHAR_META = {
    krisz: { stats: { POWER: 8, SPEED: 5, RANGE: 6, DEFENSE: 7, TECHNIQUE: 5 }, ultName: 'STOP SIGN SMASH' },
    tomi:  { stats: { POWER: 6, SPEED: 8, RANGE: 5, DEFENSE: 5, TECHNIQUE: 7 }, ultName: 'DRUNKEN FURY' },
    laci:  { stats: { POWER: 7, SPEED: 6, RANGE: 8, DEFENSE: 5, TECHNIQUE: 6 }, ultName: 'GRAND FINALE' },
    barna: { stats: { POWER: 7, SPEED: 7, RANGE: 5, DEFENSE: 6, TECHNIQUE: 8 }, ultName: 'GOLDEN GOAL' },
  };
  function charById(id){ return CHARACTERS.find(c => c.id === id) || CHARACTERS[0]; }
  function charName(id){ return charById(id).name; }
  // draws a character's IDLE-pose head/shoulder crop into a <canvas>, used by both the
  // character-select grid and the VS screen so the portrait logic only lives in one place
  function drawPortrait(canvas, charDef){
    if (!canvas) return;
    const c2d = canvas.getContext('2d');
    c2d.clearRect(0, 0, canvas.width, canvas.height);
    if (!charDef || !charDef.enabled) return;
    const img = sprites[charDef.spriteKey] && sprites[charDef.spriteKey].idle;
    if (!img || !img.complete || !img.naturalWidth) return;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const cr = charDef.portraitCrop;
    c2d.drawImage(img, cr.x*iw, cr.y*ih, cr.w*iw, cr.h*ih, 0, 0, canvas.width, canvas.height);
  }

  function pickPose(f){
    if (f.hp <= 0) return 'lose';
    if (gameOver && f.resultPose) return f.resultPose;
    if (CountdownManager.isActive()){
      // pre-round countdown: each fighter plays their own Enter (Spawn) animation, then settles into
      // idle for whatever's left of the countdown -- see EnterAnimationManager above.
      const enterPose = EnterAnimationManager.getPoseFor(f);
      return enterPose || 'idle';
    }
    // Combat System 2.0: mindegyik saját, dedikált sprite-tal rendelkezik (ld. SPRITE_DATA_COMBAT2 +
    // COMBAT2_POSES) -- Knockdown és Get Up logikailag külön állapot marad (ld. computeCombatState),
    // csak most már külön-külön rajzuk is van, nem kölcsönöznek egymástól/más pózoktól.
    if (f.knockdownTimer > 0) return 'knockdown';
    if (f.getUpTimer > 0) return 'getUp';
    if (f.beingThrownTimer > 0) return 'beingThrown';
    if (f.throwTimer > 0) return 'throw';
    if (f.ultimateActive > 0){
      const p = ultimatePoseInfo(f.charId, f.ultimateElapsed);
      // Rendering now goes through the generic clip system (see the ULTIMATES wiring block below the
      // ULTIMATES data) -- the N old static poses ("ult1".."ultN") became frames of one 'ultimate' clip,
      // so we return that single generic pose name instead of the per-pose name. ultimatePoseInfo()
      // itself is still called above/elsewhere for gameplay timing (hit window/spawn/finale), which is
      // entirely unaffected by this rendering-only change. Falls back to the old per-pose name if for
      // any reason the clip wasn't wired up for this character (defensive, shouldn't happen).
      if (p) return hasClipFor(f.charId, 'ultimate') ? 'ultimate' : p.poseName;
    }
    if (f.staggerTimer > 0) return 'hit';
    if (f.berserkTimer > 0){
      // Berserk Move: characters with a dedicated 'berserk' clip (Krisz) play it; the interim melee
      // versions (Tomi/Laci/Barna) reuse an existing pose (BERSERK_MOVES[id].pose) until their own
      // sheet lands. hasClipFor keeps this the same generic check used everywhere else.
      const bm = BERSERK_MOVES[f.charId];
      if (bm && hasClipFor(f.charId, 'berserk')) return 'berserk';
      if (bm && bm.pose) return bm.pose;
    }
    if (f.tauntTimer > 0) return 'taunt'; // purely cosmetic -- see updateFighter's interrupt guard
    if (f.attackTimer > 0 && f.attackType === 'sweep') return 'sweep';
    if (f.attackTimer > 0 && f.attackType === 'punch'){
      // Punch Combo (Tomi/Barna): 3 dedicated per-hit clips (punch1/punch2/punch3), selected by
      // which step of the chain is currently playing (f.combo.step, 0-indexed). Characters with no
      // such clip data (Krisz/Laci) transparently fall back to the single legacy 'punch' pose --
      // hasClipFor is the same generic check used everywhere else in this file, so this needed zero
      // new architecture, only new data (see SPRITE_DATA_CLIPS/CLIP_CONFIG).
      const stepPose = f.attackStepPose; // latched at attack start; survives a whiff's combo reset
      return (stepPose && hasClipFor(f.charId, stepPose)) ? stepPose : 'punch';
    }
    if (f.attackTimer > 0 && f.attackType === 'kick'){
      const stepPose = f.attackStepPose;
      return (stepPose && hasClipFor(f.charId, stepPose)) ? stepPose : 'kick';
    }
    // Crouch Block: dedicated pose, distinct from plain Crouch -- protects only against Sweep (see
    // computeGuardType/resolveGuardOutcome), loops for as long as guardType stays 'crouch'.
    if (f.guardType === 'crouch') return 'crouchBlock';
    if (f.blocking) return 'block';                // High Block (vagy blockStun-kényszerített testtartás)
    if (f.crouching) return 'crouch';              // sima guggolás -- ha a blokkot elengedi, ide esik vissza
    if (!f.onGround) return 'jump';
    // Back Walk: külön sprite-készlet, amíg a játékos az ellenféltől TÁVOLODVA mozog (facing-hez képest
    // hátrafelé) -- ld. f.movingBack (updateFighter mozgás-blokkja állítja be minden frame-ben).
    if (f.movingBack && Math.abs(f.vx) > 0.4) return 'backwalk';
    if (Math.abs(f.vx) > MOVE_SPEED*0.85) return 'run';
    if (Math.abs(f.vx) > 0.4) return 'walk';
    return 'idle';
  }

  // ---------- ANIMATION CONTROLLER ----------
  // A single, central place that decides "which sprite frame is on screen right now" -- modeled on how
  // commercial 2D fighters (SF/GG-style) drive animation. Key principles:
  //
  //   1. ONE CLOCK. Animation advances on the same clamped game-dt as everything else in loop(), never
  //      on Date.now(). So it freezes WITH hit-stop (the classic "impact freeze"), pauses WITH the
  //      game, never skips ahead after a lag spike/tab switch, and is refresh-rate independent.
  //   2. LOGIC-DRIVEN ONE-SHOTS. Poses that are owned by a gameplay timer (attacks, knockdown, get-up,
  //      being-thrown, throw, taunt) don't play on their own timeline at all -- the clip's playback
  //      position is DERIVED from that timer's progress (0..1). The animation therefore finishes on
  //      exactly the same tick the mechanic does: a fast combo hit plays its full punch clip faster,
  //      a slow one slower, and hit-stop pauses both together. No truncated or overrun animations.
  //   3. STRIDE CONTINUITY. idle/walk/backwalk/run share one persistent phase clock, so switching
  //      between them never resets the cycle to frame 0 -- and the walk/run cycle rate is scaled by
  //      the fighter's ACTUAL horizontal speed (Berserk's 1.6x movement makes the legs 1.6x faster),
  //      which kills foot-sliding.
  //   4. DECELERATION HYSTERESIS. pickPose can flicker for 1-2 ticks while velocity decays through the
  //      run->walk->idle thresholds after releasing a key. Accelerations (starting to move, jumping,
  //      attacking, getting hit) switch the displayed pose INSTANTLY for responsiveness, but
  //      slow-downs only commit after a short stability window, so those 1-2-tick flickers never
  //      reach the screen.
  //   5. NO CROSS-FADE FOR CLIP ART. Characters with real multi-frame clips (Barna) switch poses
  //      instantly -- the frames themselves are the transition, exactly like a classic fighter.
  //      Legacy single-image-per-pose characters keep their 110ms cross-fade (they need it).
  //
  // updateFighterAnimation(f, dt) is called once per rendered frame from loop() -- with dt=0 during
  // hit-stop -- and drawFighter() is now a pure reader of f.anim. Adding a future character to this
  // system requires ONLY data (SPRITE_DATA_CLIPS/CLIP_CONFIG entries), no new code.
  const LOCOMOTION_POSES = { idle: true, walk: true, backwalk: true, run: true };
  const LOCO_DECEL_HYSTERESIS_MS = 60; // ~3-4 ticks @60Hz -- short enough to be invisible, long enough to eat flickers
  const POSE_BLEND_MS = 110;           // legacy-art cross-fade length (unchanged from the old system)

  function hasClipFor(charId, pose){
    const c = CLIP_CONFIG[charId];
    if (!c || !c[pose]) return false;
    const set = sprites.clips[charId];
    return !!(set && set[pose] && set[pose].length);
  }
  function clipCycleMs(cfg){
    return cfg._cycleMs || (cfg._cycleMs = (cfg.frameMs.reduce((s, m) => s + m, 0) || 1));
  }
  // Resolves which frame of a clip is visible. Exactly one of (tMs, progress) drives playback:
  //   progress != null -> position = progress * clip length (logic-driven one-shots, principle #2)
  //   progress == null -> position = tMs, wrapping if the clip loops (free-running clips)
  function clipFrameIndexAt(charId, pose, tMs, progress){
    const c = CLIP_CONFIG[charId];
    const cfg = c && c[pose];
    const set = sprites.clips[charId];
    const arr = set && set[pose];
    if (!cfg || !arr || !arr.length) return null;
    const n = arr.length;
    const total = clipCycleMs(cfg);
    let t;
    if (progress != null){
      t = Math.max(0, Math.min(0.9999, progress)) * total;
    } else if (cfg.loop){
      t = ((tMs % total) + total) % total;
    } else {
      t = Math.min(Math.max(0, tMs), total - 1); // non-looping: hold on the final frame
    }
    let idx = n - 1;
    for (let i = 0; i < n; i++){
      if (t < cfg.frameMs[i]){ idx = i; break; }
      t -= cfg.frameMs[i];
    }
    return { img: arr[idx], idx };
  }
  // Maps a pose that is owned by a gameplay timer to that timer's 0..1 progress -- or null for poses
  // that free-run on the animation clock (idle/walk/jump/block/win/lose/...). READ-ONLY on gameplay
  // state: nothing here may ever write a combat field.
  function posePlaybackProgress(f, pose){
    if (pose === 'sweep' || pose.indexOf('punch') === 0 || pose.indexOf('kick') === 0){
      const cfg = f.attackCfg || (pose === 'sweep' ? SWEEP_CFG : ATTACKS[pose]);
      if (cfg && f.attackTimer > 0){
        const d = attackDuration(cfg);
        if (d > 0) return (d - f.attackTimer) / d;
      }
      return 1; // pose lingering past its timer (shouldn't happen) -> hold last frame
    }
    if (pose === 'knockdown'){
      // Throw utáni Knockdown: a karakter a BeingThrown klip végén már a földön fekszik, ezért a
      // Knockdown saját (állva-kezdődő) esés-animációját NEM játsszuk le újra -- rögtön az utolsó
      // (fekvő) kockán tartjuk a teljes időzítés alatt (ld. f.knockdownSkipFall beállítását updateFighterben).
      // Valódi ütés-eredetű Knockdownnál (Sweep, kombó-limit) a teljes 8-kockás esés-ív lejátszódik, ahogy eddig.
      if (f.knockdownSkipFall) return 1;
      return 1 - f.knockdownTimer / KNOCKDOWN_FRAMES;
    }
    if (pose === 'getUp') return 1 - f.getUpTimer / GETUP_FRAMES;
    if (pose === 'beingThrown') return 1 - f.beingThrownTimer / BEING_THROWN_FRAMES;
    if (pose === 'throw'){
      const d = THROW_CFG.startup + THROW_CFG.active + THROW_CFG.recovery;
      if (d > 0) return (d - f.throwTimer) / d;
    }
    if (pose === 'taunt') return 1 - f.tauntTimer / tauntTotalDuration(f.charId);
    if (pose === 'ultimate'){
      // owned by f.ultimateActive/f.ultimateElapsed exactly like the old ultimatePoseInfo-driven
      // system -- progress maps 1:1 onto the same poseDurations now used as this clip's frameMs, so
      // clipFrameIndexAt resolves the identical frame sequence/timing the old cross-fade system did.
      const total = ultimateTotalDuration(f.charId);
      return total > 0 ? Math.min(1, f.ultimateElapsed / total) : 1;
    }
    return null;
  }
  function animCommitPose(f, pose){
    const a = f.anim;
    a.prevPose = a.pose;
    a.pose = pose;
    a.poseTime = 0;
    a.pendingPose = null; a.pendingMs = 0;
    // legacy cross-fade only when NEITHER side of the transition has real clip art (principle #5);
    // Ultimate poses keep their shorter, duration-sized fade from the old system
    const clipArt = hasClipFor(f.charId, pose) || hasClipFor(f.charId, a.prevPose);
    let bd = POSE_BLEND_MS;
    const ucfg = ULTIMATES[f.charId];
    if (ucfg && pose.indexOf('ult') === 0){
      const pi = ucfg.poses.indexOf(pose);
      if (pi !== -1) bd = Math.max(30, Math.min(70, ucfg.poseDurations[pi] * 0.35));
    }
    a.blendDur = bd;
    a.blendLeft = clipArt ? 0 : bd;
    // one-shot (non-locomotion) poses own their playback position -- restart their local clock context;
    // locomotion keeps cyclePhaseMs untouched for stride continuity (principle #3)
    if (!LOCOMOTION_POSES[pose]) a.cyclePhaseMs = 0;
    // mirror the legacy fields (kept in sync for any external reader/tooling; no game code reads them)
    f.prevAnimPose = a.prevPose; f.animPose = pose; f.animPoseAt = Date.now();
  }
  function updateFighterAnimation(f, dt){
    const a = f.anim;
    // landing squash juice timer (game-time replacement of the old Date.now()-based f.landedAt)
    if (!f.wasOnGround && f.onGround) a.landSquashMs = 180;
    f.wasOnGround = f.onGround;
    if (a.landSquashMs > 0) a.landSquashMs = Math.max(0, a.landSquashMs - dt);

    const target = pickPose(f);
    if (target !== a.pose){
      // deceleration hysteresis (principle #4): only slowdown transitions inside the locomotion set
      // wait out a stability window; everything else (attacks, hits, jumps, starting to move...) is instant
      const isDecel = LOCOMOTION_POSES[target] && LOCOMOTION_POSES[a.pose] &&
                      (target === 'idle' || (a.pose === 'run' && target === 'walk'));
      if (isDecel){
        if (a.pendingPose === target){ a.pendingMs += dt; } else { a.pendingPose = target; a.pendingMs = dt; }
        if (a.pendingMs >= LOCO_DECEL_HYSTERESIS_MS) animCommitPose(f, target);
      } else {
        animCommitPose(f, target);
      }
    } else {
      a.pendingPose = null; a.pendingMs = 0;
    }

    a.poseTime += dt;
    if (a.blendLeft > 0) a.blendLeft = Math.max(0, a.blendLeft - dt);

    // locomotion phase clock, scaled by ACTUAL ground speed so feet match the ground (principle #3) --
    // |vx|/MOVE_SPEED is ~1 at normal walk/run speed and 1.6 during Berserk's movement boost
    let phaseAdv = dt;
    if (a.pose === 'walk' || a.pose === 'backwalk' || a.pose === 'run'){
      const s = Math.abs(f.vx) / MOVE_SPEED;
      phaseAdv = dt * Math.min(2, Math.max(0.5, s || 0.5));
    }
    a.cyclePhaseMs += phaseAdv;
  }

  // ---------- COMBAT SYSTEM 2.0: Combat State Machine ----------
  // f.combatState egy PUSZTÁN OLVASHATÓ, derivált címke -- minden fighter-frissítés végén újraszámolva
  // (lásd updateFighter utolsó sora), sosem külön "forrás az igazságra", ezért soha nem szinkronizálódhat
  // el a valódi fizikai/animációs állapottól. Bármi, ami tudni akarja "mit csinál most ez a karakter"
  // (AI, HUD, jövőbeli rendszerek), EZT olvassa, nem az egyedi timereket -- így a jövőbeli bővítés
  // (Launcher, Air Combo, Parry, stb.) csak egy új ágat igényel itt, semmi mást nem kell szétszednie.
  const CombatState = {
    KO: 'ko', WIN_LOSE: 'winLose', ENTER: 'enter',
    KNOCKDOWN: 'knockdown', GETTING_UP: 'gettingUp', BEING_THROWN: 'beingThrown',
    THROW: 'throw', ULTIMATE: 'ultimate', HIT_STUN: 'hitStun',
    ATTACK: 'attack', BLOCK_STUN: 'blockStun', HIGH_BLOCK: 'highBlock', CROUCH_BLOCK: 'crouchBlock',
    CROUCH: 'crouch', JUMP: 'jump', WALK: 'walk', BACKWALK: 'backwalk', IDLE: 'idle', TAUNT: 'taunt',
  };
  function computeCombatState(f){
    if (f.hp <= 0) return CombatState.KO;
    if (gameOver && f.resultPose) return CombatState.WIN_LOSE;
    if (CountdownManager.isActive()) return CombatState.ENTER;
    if (f.knockdownTimer > 0) return CombatState.KNOCKDOWN;
    if (f.getUpTimer > 0) return CombatState.GETTING_UP;
    if (f.beingThrownTimer > 0) return CombatState.BEING_THROWN;
    if (f.throwTimer > 0) return CombatState.THROW;
    if (f.ultimateActive > 0) return CombatState.ULTIMATE;
    if (f.staggerTimer > 0) return CombatState.HIT_STUN;
    if (f.tauntTimer > 0) return CombatState.TAUNT;
    if (f.attackTimer > 0) return CombatState.ATTACK;
    if (f.blockStunTimer > 0) return CombatState.BLOCK_STUN;
    if (f.guardType === 'crouch') return CombatState.CROUCH_BLOCK;
    if (f.guardType === 'high') return CombatState.HIGH_BLOCK;
    if (f.crouching) return CombatState.CROUCH;
    if (!f.onGround) return CombatState.JUMP;
    if (f.movingBack && Math.abs(f.vx) > 0.4) return CombatState.BACKWALK;
    if (Math.abs(f.vx) > 0.4) return CombatState.WALK;
    return CombatState.IDLE;
  }

  let mode = '2p';   // '2p' | '1p' | 'training'
  let stage = 'akacfa'; // 'akacfa' (a 'club'/'pub'/'garden' kikapcsolva, de a rajzoló-függvények megmaradtak későbbre)
  // ---- pályaválasztó: adatvezérelt lista + "VÉLETLEN" opció (a stageGrid-et ebből építjük fel) ----
  const STAGE_LIST = ['akacfa', 'morrisons2', 'laciverse', 'siofok', 'siofok_night', 'novarock']; // ide kerül majd egy új pálya id-je is, ha bővül a lista
  const STAGE_NAMES = { akacfa: 'AKÁCFA SÖRÖZŐ', morrisons2: "MORRISON'S 2", laciverse: 'LACIVERSE', siofok: 'SIÓFOK (NAPPAL)', siofok_night: 'SIÓFOK (ÉJSZAKA)', novarock: 'NOVAROCK' };
  let stageCursor = 0;        // highlighted/selected card index a stageGrid-ben (0..STAGE_LIST.length-1 = konkrét pálya, utolsó = VÉLETLEN)
  let stageIsRandom = false;  // true, ha a VÉLETLEN kártya van kiválasztva -- a tényleges pálya csak HARC!-kor sorsolódik ki

  // ---------- GAME STATE MACHINE ----------
  // MAIN_MENU -> CHARACTER_SELECT -> STAGE_SELECT -> VS_SCREEN -> FIGHT <-> PAUSED
  // the fight code (update()/draw() of the actual match) only ever runs while gameState === 'FIGHT',
  // so nothing moves or attacks in the background while any menu screen (or the PAUSED overlay) is showing.
  let gameState = 'MAIN_MENU';
  let mmCursor = 0;              // 0 = Player Versus, 1 = CPU Versus (Versus Mode submenu highlight)
  let mainMenuStep = 'modeList'; // 'modeList' (Story/Versus/Arcade/Training) | 'versusSubmenu' (Player/CPU Versus) -- only sub-states while gameState === 'MAIN_MENU'
  let modeListCursor = 0;        // 0 = Versus Mode, 1 = Training Mode -- egyelőre csak ez a kettő oldott fel a modeList-en
  let csStep = 'p1';             // 'p1' | 'p2' | 'cpu' — whose turn it is on the character-select screen
  let csCursor = 0;              // highlighted slot index (0..5) in the character grid
  let pauseCursor = 0;           // highlighted option index (Folytatás/Újraindítás/[CPU Viselkedés]/Kilépés) on the Escape pause menu -- ld. currentPauseOptions()
  let pauseStep = 'main';        // 'main' (Folytatás/Újraindítás/CPU Viselkedés/Kilépés) | 'cpuBehavior' (Training Mode CPU-viselkedés választó) -- csak PAUSED alatti sub-state
  let cpuBehaviorCursor = 0;     // highlighted index a pauseStep==='cpuBehavior' 4 gombja közül
  let matchEndCursor = 0;        // highlighted option (0=Újraindítás,1=Vissza a menübe) on the match-end overlay
  let p1CharId = null, p2CharId = null; // chosen character ids; p2CharId is also used for the CPU's pick
  let cpuDifficulty = 'normal'; // 'easy' | 'normal' | 'hard' | 'insane' -- only relevant when mode === '1p' (see AI_DIFFICULTY)
  let difficultyCursor = 1;     // index into AI_DIFFICULTY_LIST (1 = 'normal', the default highlight)
  // ---------- TRAINING MODE ----------
  // A CPU-t (mindig P2 oldalon) itt NEM az aiThink súlyozott döntési rendszere vezérli, hanem egy
  // rögzített, a Szünet menüből (Esc/Options -> CPU VISELKEDÉS) bármikor átállítható viselkedés --
  // ld. trainingCpuThink(). Alapértelmezésben Mozdulatlan, ahogy a kérés mondja ("A CPU csak egy
  // helyben áll alapból").
  const TRAINING_CPU_BEHAVIORS = ['still', 'block', 'crouchBlock', 'attack'];
  const TRAINING_CPU_BEHAVIOR_LABELS = { still: 'MOZDULATLAN', block: 'VÉDEKEZŐ', crouchBlock: 'ALSÓ VÉDEKEZŐ', attack: 'TÁMADÓ' };
  let trainingCpuBehavior = 'still';
  // ---------- ARCADE MODE ----------
  // Létra-jelleg: a játékos (P1) egyszer megküzd az összes többi feloldott karakterrel, a
  // CHARACTERS lista sorrendjében (a saját választása kihagyva), fokozatosan nehezedő CPU-val --
  // ld. arcadeDifficultyForIndex(). Nincs continue: ha a játékos veszít egy meccset (BO3), a teljes
  // menetnek vége (Game Over), újra a karakterválasztástól kell kezdeni -- ld. MatchManager.showMatchEnd.
  let arcadeOpponents = []; // charId-k sorban, a startArcadeRun() tölti fel (p1CharId kihagyva)
  let arcadeIndex = 0;      // hányadik ellenfélnél tart éppen (0-alapú index az arcadeOpponents-be)
  function arcadeDifficultyForIndex(i){
    const n = arcadeOpponents.length;
    if (n <= 1) return AI_DIFFICULTY_LIST[AI_DIFFICULTY_LIST.length - 1];
    const levels = AI_DIFFICULTY_LIST.length;
    const idx = Math.round(i * (levels - 1) / (n - 1)); // egyenletesen elosztva Easy..Insane között
    return AI_DIFFICULTY_LIST[idx];
  }
  function startArcadeRun(){
    arcadeOpponents = CHARACTERS.filter(c => c.enabled && c.id !== p1CharId).map(c => c.id);
    arcadeIndex = 0;
    p2CharId = arcadeOpponents[0];
    cpuDifficulty = arcadeDifficultyForIndex(0);
  }

  function makeFighter(opts){
    return Object.assign({
      x: 0, y: GROUND_Y, vx: 0, vy: 0, w: 70, h: 160,
      facing: 1, hp: 100, maxHp: 100,
      trainingHitCount: 0, // Training Mode: hányadik sebzés-esemény jön -- minden 3. után teljes gyógyulás (ld. applyDamage)
      charId: 'krisz',
      onGround: true, blocking: false,
      attackType: null, attackTimer: 0, hasHit: false,
      staggerTimer: 0,
      // ---- Combat System 2.0: guard type, crouch, throw, knockdown/get-up ----
      guardType: null,        // null | 'high' | 'crouch' -- melyik blokk-fajta aktív éppen (Block gomb alapján)
      crouching: false,       // tiszta guggolás (Le, Block NÉLKÜL) -- nem blokkol, csak a testtartás
      throwTimer: 0,          // Throw saját idővonala (startup+active+recovery), SOSEM az attackTimer-t használja
      throwHasHit: false,
      throwIsBack: false,     // Throw Direction System: a dobás indításának PILLANATában eldőlt (ld. startThrow) --
                               // igaz esetén Back Throw (valódi oldalváltás), hamis esetén a régi Forward Throw
      throwArcActive: false,  // igaz, amíg a Back Throw folyamatos, íves pozícióváltása zajlik (NEM teleport)
      throwArcStartX: 0,      // a megragadás pillanatában rögzített kezdő X
      throwArcEndX: 0,        // a támadó mögötti célpozíció X-e -- eddig interpolálunk
      throwChordPunchTimer: 0, // ms -- ld. THROW_CHORD_WINDOW_MS: mennyi ideje volt friss Punch nyomás
      throwChordKickTimer: 0,  // ms -- ugyanez Kicknek
      beingThrownTimer: 0,    // az ELDOBOTT fél oldalán -- rövid "repülés" a földetérésig
      knockdownTimer: 0,      // (lásd lejjebb is -- ez a mező már létezett, itt csak dokumentálva)
      knockdownSkipFall: false, // igaz, ha ez a Knockdown egy Throw folytatása -- ilyenkor a Knockdown
                                 // klip esés-animációja NEM játszódik le újra (a karakter már a földön
                                 // fekszik a BeingThrown végén), ld. posePlaybackProgress('knockdown')
      getUpTimer: 0,          // Knockdown után -- Get Up állapot, még mindig nem irányítható
      combatState: 'idle',    // pusztán derived/olvasható címke -- lásd computeCombatState()
      // Berserk meter: starts EMPTY and fills in real time (BERSERK_FILL_MS, slow) PLUS a chunk every
      // time this fighter TAKES a hit (BERSERK_DMG_FILL of the bar per hit). manaMs counts UP from 0 to
      // manaFillMs; at full the bar flashes red + vibrates until the Berserk Move (special button) is used,
      // which spends the whole bar. No longer a timed buff — it now GATES the Berserk Move attack.
      manaMs: 0, manaFillMs: BERSERK_FILL_MS,
      berserkActive: 0, // (retained as 0; the old 5s speed/damage buff was removed — Berserk is now a move)
      // ---- Berserk Move state (see BERSERK_MOVES config) — a meter-gated special attack ----
      berserkTimer: 0,      // ms remaining in the Berserk Move animation (0 = not performing it)
      berserkElapsed: 0,    // ms elapsed since the Berserk Move started
      berserkHasHit: false, // melee Berserk Move: has the single hit window already connected?
      berserkSpawned: false,// projectile Berserk Move: has the projectile already been released?
      danceParticles: [],
      walkPhase: 0,
      hitFlash: 0,
      koFall: 0,
      // ---- ComboManager state (see COMBOS config) ----
      attackCfg: null,       // live stat block (startup/active/recovery/dmg/reach/knock/hitStun/blockStun) for whichever hit is currently playing
      blockStunTimer: 0,     // ms -- forced into .blocking, can't move/attack while this is running
      _prevInput: { punch: false, kick: false, taunt: false }, // for edge-detecting fresh button presses (ComboManager only cares about NEW presses, not held state)
      motion: makeMotion(), // motion-input (special-move) tracker -- see the MOTION INPUTS section
      combo: {
        def: null,            // the COMBOS[...] entry currently in progress, or null
        step: 0,               // which hit within def.hits is currently playing / was last confirmed
        windowOpen: false,     // true once the current hit's Hit Confirm has resolved (landed or blocked)
        windowTimer: 0,        // ms left to input the next step before the combo resets (COMBO_WINDOW_MS)
        buffered: null,        // an early press waiting to be consumed the instant the window opens
        bufferTimer: 0,        // ms left before a buffered press expires unused (INPUT_BUFFER_MS)
        hitCount: 0,           // confirmed CLEAN hits so far in this combo -- drives the "N HIT" counter + damage scaling
        counterHoldTimer: 0,   // ms left before the "N HIT" counter hides after the combo ends (COMBO_COUNTER_HOLD_MS)
      },
      // ---- UltimateManager state (see ULTIMATES config) ----
      ultimateUsed: false,   // once true, can never be triggered again this match
      ultimateActive: 0,     // frames remaining in the current ultimate playback (0 = not performing one)
      ultimateElapsed: 0,    // frames elapsed since this ultimate started (drives which pose shows)
      ultimateHasHit: false, // so the single hitbox window can only connect once per use
      ultimateFinaleShown: false, // one-shot guard for an ultimate's optional finalePoseIndex banner/fireworks
      // ---- EnterAnimationManager state (see ENTER_ANIMATIONS config) ----
      enterAnimActive: false,   // true while this fighter's walk-in animation is still playing
      enterAnimElapsed: 0,      // ms elapsed since this fighter's Enter animation started
      enterAnimLastPoseIdx: -1, // so per-pose hooks (sound/particles) fire once per pose, not every frame
      // ---- CPU AI state (see AI_DIFFICULTY / aiThink) -- only meaningful for a CPU-controlled
      // fighter (mode==='1p', always p2), completely inert/unused for a human-controlled one ----
      difficulty: 'normal', // 'easy' | 'normal' | 'hard' | 'insane' -- set from cpuDifficulty in resetGame()
      ai: {
        plan: { left:false, right:false, up:false, down:false, punch:false, kick:false, special:false, ultimate:false, block:false },
        decisionTimer: 0,           // ms until the next full baseline re-plan (approach/retreat/attack/etc.)
        reaction: null,             // a pending delayed reaction to something just observed: { kind:'block'|'punish', dueIn: ms }
        holdTimer: 0,               // ms left to keep holding the current reaction stance before reassessing
        lastOtherAttacking: false,  // edge-detection: was the opponent mid-attack last frame?
        lastOtherInRecovery: false, // edge-detection: was the opponent's attack in its whiffable recovery last frame?
        comboFollowUp: false,       // rolled once per combo opener (via comboChance) -- will this CPU chase the follow-up hit(s)?
        lastComboWindowOpen: false, // edge-detection on this fighter's OWN combo.windowOpen
      },
      resultPose: null,
      // ---- Taunt / Back Walk (generic, all characters) ----
      tauntTimer: 0,    // ms remaining in the current Taunt playback (0 = not taunting) -- purely
                        // cosmetic, no damage/no benefit; interrupted immediately if hit (see updateFighter)
      movingBack: false, // true while this fighter is moving AWAY from the opponent (facing-relative) --
                        // drives the dedicated BackWalk pose instead of a mirrored/reversed Walk
      // --- animation-only bookkeeping below: purely cosmetic, never read by physics/AI/collision code ---
      wasOnGround: true, landedAt: -9999,
      animPose: 'idle', prevAnimPose: 'idle', animPoseAt: 0,
      // ---- ANIMATION CONTROLLER state (see updateFighterAnimation) ----
      // All timing here is GAME time (accumulated from the loop's clamped dt), never wall-clock:
      // it freezes together with hit-stop, survives tab-switches/lag spikes, and stays correct on
      // any display refresh rate. drawFighter is a pure READER of this object.
      anim: {
        pose: 'idle',       // pose currently being DISPLAYED (may lag pickPose by a tiny hysteresis)
        prevPose: 'idle',   // pose we most recently left (used only for the legacy cross-fade)
        poseTime: 0,        // ms of game time spent in the current pose
        blendDur: 110,      // duration of the legacy-art cross-fade for the current transition
        blendLeft: 0,       // ms of that cross-fade still remaining (0 = no blending in progress)
        cyclePhaseMs: 0,    // shared locomotion phase clock -- persists across idle/walk/run/backwalk
                            // switches so the stride never visibly restarts at frame 0 mid-movement
        pendingPose: null,  // deceleration hysteresis: candidate pose waiting out its stability window
        pendingMs: 0,       //   ...and how long it has been the candidate
        landSquashMs: 0,    // ms left of the brief landing-squash juice (replaces Date.now()-based landedAt)
      },
      animSeed: Math.random()*10,
    }, opts);
  }

  let p1, p2, gameOver, timeLeft, timerAcc, shake, bannerTimer, hitSparks, hitStopTimer, impactFlash;

  // updates the small "ULT READY / ULT USED" label under a fighter's HP bar
  function updateUltHud(f, elId){
    const el = document.getElementById(elId);
    const ready = (mode === 'training') || !f.ultimateUsed; // Training Mode: a HUD mindig "kész"-nek mutatja, sosem "elhasznált"-nak
    el.src = ready ? UI_ASSETS.ultReady : UI_ASSETS.ultUsed;
    el.classList.toggle('ready', ready);
  }

  // Combo Counter: csak 2+ egymás utáni találatnál jelenik meg ("2 HIT" / "3 HIT" / ...), és a kombó
  // megszakadása után is kint marad még COMBO_COUNTER_HOLD_MS-ig (lásd ComboManager.update /
  // resetCombo), utána f.combo.hitCount nullázódik és a felirat magától eltűnik.
  function updateComboCounterUI(f, elId){
    const el = document.getElementById(elId);
    const n = f.combo.hitCount;
    if (n >= 2){
      el.textContent = n + ' HIT';
      el.classList.add('show');
    } else {
      el.classList.remove('show');
    }
  }

  function resetGame(){
    p1 = makeFighter({ x: W*0.28, facing: 1, charId: p1CharId || 'krisz' });
    // 1p módban p2-t a CPU vezérli -- a menüben választott nehézségi szint itt kerül rá a fighterre
    // (2p módban a difficulty mező jelen van, de sosem olvassa senki, mert getInput emberi inputot ad)
    p2 = makeFighter({ x: W*0.72, facing: -1, charId: p2CharId || 'tomi', difficulty: (mode === '1p' || mode === 'arcade') ? cpuDifficulty : 'normal' });
    gameOver = false;
    timeLeft = ROUND_TIME;
    timerAcc = 0;
    shake = 0;
    bannerTimer = 0;
    hitSparks = [];
    hitStopTimer = 0;
    impactFlash = 0;
    projectiles = []; // clear any in-flight bottle etc. from a previous match
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('pauseMenu').style.display = 'none';
    // Training Mode: nincs időkorlát -- a timer helyén egy "∞" jel marad kint, sosem számol vissza
    document.getElementById('timer').textContent = (mode === 'training') ? '∞' : timeLeft;
    document.getElementById('nameP1').textContent = charName(p1.charId);
    document.getElementById('nameP2').textContent = charName(p2.charId);
    document.getElementById('hintNameP1').textContent = charName(p1.charId);
    document.getElementById('hintNameP2').textContent = charName(p2.charId);
    drawPortrait(document.getElementById('hudPortraitP1'), charById(p1.charId));
    drawPortrait(document.getElementById('hudPortraitP2'), charById(p2.charId));
    updateUltHud(p1, 'ultIconP1');
    updateUltHud(p2, 'ultIconP2');
    // az előző kör végén esetleg még kint ragadt "N HIT" felirat azonnali eltüntetése -- enélkül
    // egy pillanatra újra látszódna a countdown alatt, mielőtt update() átvenné az irányítást
    document.getElementById('comboCounterP1').classList.remove('show');
    document.getElementById('comboCounterP2').classList.remove('show');
  }

  // ---------- MENU WIRING ----------
  function showPanel(id){
    ['mainMenu','difficultySelect','charSelect','vsScreen','menu','overlay'].forEach(pid=>{
      const el = document.getElementById(pid);
      if (pid === 'overlay') return; // overlay is managed separately (only shown on KO/timeout)
      el.style.display = (pid === id) ? 'flex' : 'none';
    });
    // On the title/main-menu screen only, the portrait hero logo is allowed to take its full height;
    // every other screen (char/stage/difficulty select, VS, fight) hides it so the frame has room.
    document.body.classList.toggle('atTitle', id === 'mainMenu');
    syncBackNav();
  }
  // Show the global top-right back button only on menu sub-screens that go back one step
  // (never the top-level mode list, the fight, or screens with their own back/menu buttons).
  function syncBackNav(){
    const b = document.getElementById('backNav');
    if (!b) return;
    b.classList.toggle('show',
      (gameState === 'MAIN_MENU' && mainMenuStep === 'versusSubmenu') ||
      gameState === 'DIFFICULTY_SELECT' || gameState === 'CHARACTER_SELECT' || gameState === 'STAGE_SELECT');
  }

  function goToMainMenu(){
    gameState = 'MAIN_MENU';
    RoundManager.reset();
    p1CharId = null; p2CharId = null;
    csStep = 'p1'; csCursor = 0;
    mmCursor = (mode === '1p') ? 1 : 0;
    renderMainMenuCursor();
    modeListCursor = (mode === 'training') ? 2 : ((mode === 'arcade') ? 1 : 0);
    arcadeIndex = 0; // visszatérve a menübe, egy esetleges félbehagyott arcade-menet ne maradjon állapotban
    renderModeListCursor();
    showMainMenuStep('modeList'); // always land back on the top-level mode list, never mid-submenu
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('pauseMenu').style.display = 'none';
    showPanel('mainMenu');
  }

  // Main menu has two levels while gameState stays 'MAIN_MENU': the top-level mode list
  // (Story/Versus/Arcade/Training -- Versus Mode and Training Mode are unlocked, Story/Arcade stay
  // locked placeholders) and, once Versus Mode is picked, the Player Versus / CPU Versus submenu
  // (the old top-level P1 VS P2 / P1 VS CPU choice). Training Mode has no submenu of its own -- it
  // goes straight to character select, exactly like CPU Versus, just without a difficulty screen
  // (the CPU's behavior in Training is fixed/manual, see trainingCpuBehavior + the Pause menu).
  function showMainMenuStep(step){
    mainMenuStep = step;
    document.getElementById('modeListView').style.display = (step === 'modeList') ? 'flex' : 'none';
    document.getElementById('versusSubmenu').style.display = (step === 'versusSubmenu') ? 'flex' : 'none';
    syncBackNav();
  }
  function renderModeListCursor(){
    document.getElementById('versusModeBtn').classList.toggle('selected', modeListCursor === 0);
    document.getElementById('arcadeModeBtn').classList.toggle('selected', modeListCursor === 1);
    document.getElementById('trainingModeBtn').classList.toggle('selected', modeListCursor === 2);
  }
  function startTrainingMode(){
    mode = 'training';
    trainingCpuBehavior = 'still'; // "A CPU csak egy helyben áll alapból" -- a Szünet menüből állítható át
    enterCharacterSelect();
  }
  function startArcadeMode(){
    mode = 'arcade';
    enterCharacterSelect(); // csak P1 választ -- utána a startArcadeRun() automatikusan kijelöli az első ellenfelet
  }
  document.getElementById('versusModeBtn').addEventListener('mouseenter', ()=>{ modeListCursor = 0; renderModeListCursor(); });
  document.getElementById('versusModeBtn').addEventListener('click', ()=>{
    modeListCursor = 0;
    showMainMenuStep('versusSubmenu');
    renderMainMenuCursor();
  });
  document.getElementById('arcadeModeBtn').addEventListener('mouseenter', ()=>{ modeListCursor = 1; renderModeListCursor(); });
  document.getElementById('arcadeModeBtn').addEventListener('click', ()=>{
    modeListCursor = 1;
    startArcadeMode();
  });
  document.getElementById('trainingModeBtn').addEventListener('mouseenter', ()=>{ modeListCursor = 2; renderModeListCursor(); });
  document.getElementById('trainingModeBtn').addEventListener('click', ()=>{
    modeListCursor = 2;
    startTrainingMode();
  });

  // ---------- PAUSE MENU (Escape during FIGHT) ----------
  // gameState flips FIGHT <-> PAUSED; loop() only runs update()/draw() while gameState === 'FIGHT',
  // so switching to PAUSED freezes the match exactly where it was (last drawn frame stays on the
  // canvas underneath the pause panel). lastFrameTs is reset to null on every transition back into
  // FIGHT so the delta-time system (Ultimate/Berserk timers) never sees a huge dt spike for the
  // real-world time spent sitting in the pause menu.
  // A "CPU VISELKEDÉS" opció csak Training Mode-ban jelenik meg -- currentPauseOptions() adja vissza
  // a jelenlegi módban ténylegesen elérhető opciók listáját, ebben navigál a pauseCursor.
  function currentPauseOptions(){
    return (mode === 'training') ? ['resume', 'restart', 'cpuBehavior', 'quit'] : ['resume', 'restart', 'quit'];
  }
  function pauseGame(){
    if (gameState !== 'FIGHT') return;
    gameState = 'PAUSED';
    pauseCursor = 0;
    pauseStep = 'main';
    showPauseStep('main');
    document.getElementById('pauseCpuBehaviorBtn').style.display = (mode === 'training') ? '' : 'none';
    renderPauseCursor();
    document.getElementById('pauseMenu').style.display = 'flex';
  }
  function resumeGame(){
    document.getElementById('pauseMenu').style.display = 'none';
    gameState = 'FIGHT';
    lastFrameTs = null;
  }
  function restartFromPause(){
    document.getElementById('pauseMenu').style.display = 'none';
    RoundManager.reset();
    resetGame(); // reuses the already-chosen p1CharId/p2CharId and current stage — same fight, fresh start
    gameState = 'FIGHT';
    lastFrameTs = null;
    CountdownManager.start();
  }
  function quitFromPause(){
    document.getElementById('pauseMenu').style.display = 'none';
    goToMainMenu();
  }
  // ---------- Training Mode: CPU VISELKEDÉS sub-screen (Szünet menün belül) ----------
  // Ugyanaz a kétszintű minta, mint a főmenü modeList/versusSubmenu -- pauseStep 'main'-ról
  // 'cpuBehavior'-ra vált, majd Escape/Vissza-val tér vissza, anélkül hogy folytatná a meccset.
  function showPauseStep(step){
    pauseStep = step;
    document.getElementById('pauseMainView').style.display = (step === 'main') ? 'flex' : 'none';
    document.getElementById('pauseCpuBehaviorView').style.display = (step === 'cpuBehavior') ? 'flex' : 'none';
  }
  const CPU_BEHAVIOR_BTN_IDS = ['cpuBehaviorStillBtn', 'cpuBehaviorBlockBtn', 'cpuBehaviorCrouchBlockBtn', 'cpuBehaviorAttackBtn']; // same order as TRAINING_CPU_BEHAVIORS
  function enterCpuBehaviorSelect(){
    cpuBehaviorCursor = Math.max(0, TRAINING_CPU_BEHAVIORS.indexOf(trainingCpuBehavior));
    renderCpuBehaviorCursor();
    showPauseStep('cpuBehavior');
  }
  function renderCpuBehaviorCursor(){
    CPU_BEHAVIOR_BTN_IDS.forEach((id, idx) => document.getElementById(id).classList.toggle('cursor', idx === cpuBehaviorCursor));
  }
  function confirmCpuBehaviorSelect(){
    trainingCpuBehavior = TRAINING_CPU_BEHAVIORS[cpuBehaviorCursor];
    showPauseStep('main');
  }
  CPU_BEHAVIOR_BTN_IDS.forEach((id, idx) => {
    const btn = document.getElementById(id);
    btn.addEventListener('mouseenter', ()=>{ cpuBehaviorCursor = idx; renderCpuBehaviorCursor(); });
    btn.addEventListener('click', ()=>{ cpuBehaviorCursor = idx; confirmCpuBehaviorSelect(); });
  });
  function renderPauseCursor(){
    const opts = currentPauseOptions();
    document.getElementById('pauseResumeBtn').classList.toggle('cursor', opts[pauseCursor] === 'resume');
    document.getElementById('pauseRestartBtn').classList.toggle('cursor', opts[pauseCursor] === 'restart');
    document.getElementById('pauseCpuBehaviorBtn').classList.toggle('cursor', opts[pauseCursor] === 'cpuBehavior');
    document.getElementById('pauseQuitBtn').classList.toggle('cursor', opts[pauseCursor] === 'quit');
  }
  function confirmPauseOption(){
    const opt = currentPauseOptions()[pauseCursor];
    if (opt === 'resume') resumeGame();
    else if (opt === 'restart') restartFromPause();
    else if (opt === 'cpuBehavior') enterCpuBehaviorSelect();
    else if (opt === 'quit') quitFromPause();
  }
  [['pauseResumeBtn','resume',resumeGame],['pauseRestartBtn','restart',restartFromPause],
   ['pauseCpuBehaviorBtn','cpuBehavior',enterCpuBehaviorSelect],['pauseQuitBtn','quit',quitFromPause]].forEach(([id,name,action])=>{
    const btn = document.getElementById(id);
    btn.addEventListener('mouseenter', ()=>{
      const idx = currentPauseOptions().indexOf(name);
      if (idx !== -1){ pauseCursor = idx; renderPauseCursor(); }
    });
    btn.addEventListener('click', action);
  });

  function renderMainMenuCursor(){
    document.getElementById('modeBtn2p').classList.toggle('selected', mmCursor === 0);
    document.getElementById('modeBtn1p').classList.toggle('selected', mmCursor === 1);
  }
  function confirmMainMenu(){
    mode = (mmCursor === 1) ? '1p' : '2p';
    // CPU Versus -> nehézségi szint választás jön előbb; Player Versus -> egyenesen karakterválasztás
    if (mode === '1p') enterDifficultySelect();
    else enterCharacterSelect();
  }
  [['modeBtn2p',0],['modeBtn1p',1]].forEach(([id,idx])=>{
    const btn = document.getElementById(id);
    btn.addEventListener('mouseenter', ()=>{ mmCursor = idx; renderMainMenuCursor(); });
    btn.addEventListener('click', ()=>{ mmCursor = idx; confirmMainMenu(); });
  });

  // ---------- CPU VERSUS: DIFFICULTY SELECT ----------
  const DIFFICULTY_BTN_IDS = ['diffBtnEasy', 'diffBtnNormal', 'diffBtnHard', 'diffBtnInsane']; // same order as AI_DIFFICULTY_LIST
  function enterDifficultySelect(){
    gameState = 'DIFFICULTY_SELECT';
    renderDifficultyCursor();
    showPanel('difficultySelect');
  }
  function renderDifficultyCursor(){
    DIFFICULTY_BTN_IDS.forEach((id, idx) => document.getElementById(id).classList.toggle('selected', idx === difficultyCursor));
  }
  function confirmDifficultySelect(){
    cpuDifficulty = AI_DIFFICULTY_LIST[difficultyCursor];
    enterCharacterSelect();
  }
  DIFFICULTY_BTN_IDS.forEach((id, idx) => {
    const btn = document.getElementById(id);
    btn.addEventListener('mouseenter', ()=>{ difficultyCursor = idx; renderDifficultyCursor(); });
    btn.addEventListener('click', ()=>{ difficultyCursor = idx; confirmDifficultySelect(); });
  });

  function updateCharSelectTitle(){
    const el = document.getElementById('csTitle');
    if (csStep === 'p1') el.textContent = (mode === 'arcade') ? 'ARCADE MÓD – VÁLASSZ KARAKTERT' : 'PLAYER 1 – VÁLASSZ KARAKTERT';
    else if (csStep === 'p2') el.textContent = 'PLAYER 2 – VÁLASSZ KARAKTERT';
    else el.textContent = 'VÁLASSZ CPU KARAKTERT';
  }
  function enterCharacterSelect(){
    gameState = 'CHARACTER_SELECT';
    csStep = 'p1';
    p1CharId = null; p2CharId = null;
    csCursor = 0;
    csLastGridCursor = 0;
    csPreviewCharId = null; // a preview panel frissen renderelődjön újra belépéskor
    updateCharSelectTitle();
    renderCharGrid();
    showPanel('charSelect');
  }
  // A "VÉLETLEN KARAKTER" gomb a 3x2 rács ALATT ül, de a kurzor-navigáció szempontjából egy
  // virtuális, 7. rácshelynek számít (index === CHARACTERS.length) -- így ugyanaz az irányítás
  // (nyilak/WASD/D-Pad + Enter/Cross) éri el, mint bármelyik karaktert, nem kell hozzá külön gomb.
  const RANDOM_CURSOR_IDX = CHARACTERS.length;
  const CS_GRID_COLS = 6, CS_GRID_ROWS = 4; // 6x4 = 24 slot -- a zárolt helyeket a kurzor átugorja
  let csLastGridCursor = 0; // ahová a RANDOM gombról Fel-lel visszatérünk (az utolsó rács-pozíció)
  // moves the highlighted slot in direction (dx,dy) across the 6x4 grid, stepping past locked
  // slots automatically (they can never be landed on) and stopping at the grid edge otherwise --
  // ha lefelé lépve már nincs több feloldott slot, a kurzor a rács alatti RANDOM gombra kerül,
  // onnan felfelé pedig vissza az utoljára kiemelt rács-pozícióra.
  function moveCursor(dx, dy){
    if (csCursor === RANDOM_CURSOR_IDX){
      if (dy < 0){ csCursor = csLastGridCursor; } // Fel a RANDOM gombról -> vissza a rácsba
      highlightCharGridCursor();
      return;
    }
    const col0 = csCursor % CS_GRID_COLS, row0 = Math.floor(csCursor / CS_GRID_COLS);
    let col = col0, row = row0, moved = false;
    while (true){
      col += dx; row += dy;
      if (col < 0 || col >= CS_GRID_COLS || row < 0 || row >= CS_GRID_ROWS) break; // fell off the grid
      const idx = row*CS_GRID_COLS + col;
      if (CHARACTERS[idx] && CHARACTERS[idx].enabled){ csCursor = idx; moved = true; break; }
    }
    if (!moved && dy > 0){
      // lefelé nincs több feloldott slot -> a rács alatti RANDOM gombra ugrunk
      csLastGridCursor = csCursor;
      csCursor = RANDOM_CURSOR_IDX;
    }
    highlightCharGridCursor();
  }
  function confirmCharSelect(){
    if (csCursor === RANDOM_CURSOR_IDX){ selectRandomCharacter(); return; }
    const c = CHARACTERS[csCursor];
    if (!c || !c.enabled) return; // locked slot — can't be confirmed
    if (csStep === 'p1'){
      p1CharId = c.id;
      if (mode === 'arcade'){
        startArcadeRun();
        enterStageSelect();
        return;
      }
      csStep = (mode === '1p' || mode === 'training') ? 'cpu' : 'p2';
      csCursor = 0;
      updateCharSelectTitle();
      renderCharGrid();
    } else {
      p2CharId = c.id;
      // Karakterválasztás után a pályaválasztás jön, az "ÖSSZECSAPÁS" (VS) képernyő csak ezután,
      // közvetlenül a mérkőzés indulása előtt jelenik meg (lásd startBtn / enterVsScreen).
      enterStageSelect();
    }
  }
  // Véletlenszerű, feloldott karakter azonnali kiválasztása: a kurzort a sorsolt karakterre
  // állítja, majd újrahasznosítja a már meglévő confirmCharSelect() folyamatot (P1->P2/CPU->pálya).
  // Hívható közvetlenül (gombkattintás) vagy a confirmCharSelect() RANDOM_CURSOR_IDX ágából
  // (nyilakkal a gombra navigálva, majd Enter/Cross-szal "rákattintva").
  function selectRandomCharacter(){
    const pool = CHARACTERS.filter(c => c.enabled);
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    csCursor = CHARACTERS.indexOf(pick);
    confirmCharSelect();
  }
  // Builds the 6 slot elements ONCE per turn (called on entering the screen and whenever the
  // badges/title need to change after a pick). Hover/cursor-highlight updates are handled
  // separately by highlightCharGridCursor(), which only toggles a CSS class and never touches
  // the DOM tree — rebuilding the whole grid on every mouse hover (the old approach) replaced the
  // very element the mouse was over mid-gesture, which is a well-known way to make the browser
  // drop the synthesized 'click' event (mousedown target no longer exists at mouseup time). Clicks
  // and hover are both handled via a single delegated listener on #charGrid (see below), so they
  // keep working even though slot elements can still be rebuilt wholesale on turn changes.
  // Tiszta, DOM-független segédfüggvény: megmondja egy adott karakterről, hogy P1 és/vagy P2(/CPU)
  // már kiválasztotta-e, és milyen jelvényszöveget kapjon -- innen tölti fel renderCharGrid() a
  // 'pickedP1'/'pickedP2' CSS osztályokat (tartós kék/piros keret a lila kurzor-kiemelés helyett).
  function charPickState(c){
    const isP1Pick = !!(c && c.enabled && p1CharId === c.id);
    const isP2Pick = !!(c && c.enabled && p2CharId === c.id);
    const badges = [];
    if (isP1Pick) badges.push('P1');
    if (isP2Pick) badges.push((mode === '1p' || mode === 'training' || mode === 'arcade') ? 'CPU' : 'P2');
    return { isP1Pick, isP2Pick, badgeText: badges.join(' / ') };
  }
  function renderCharGrid(){
    const grid = document.getElementById('charGrid');
    grid.innerHTML = '';
    CHARACTERS.forEach((c, idx) => {
      const el = document.createElement('div');
      // már kiválasztott karakterek tartós, jól látható kerete: P1 = kék, P2/CPU = piros --
      // független attól, hogy a kurzor épp máshol jár-e (l. .pickedP1/.pickedP2 a CSS-ben)
      const { isP1Pick, isP2Pick, badgeText } = charPickState(c);
      el.className = 'charSlot'
        + (!c.enabled ? ' locked' : '')
        + (c.enabled && idx === csCursor ? ' cursor' : '')
        + (isP1Pick ? ' pickedP1' : '')
        + (isP2Pick ? ' pickedP2' : '');
      el.dataset.idx = idx;
      if (c.enabled){
        const canvas = document.createElement('canvas');
        canvas.className = 'portraitCanvas';
        canvas.width = 140; canvas.height = 140;
        el.appendChild(canvas);
        const nameEl = document.createElement('div');
        nameEl.className = 'slotName';
        nameEl.textContent = c.name;
        el.appendChild(nameEl);
        if (badgeText){
          let tagClass = 'slotTag';
          if (isP1Pick) tagClass += ' tagP1';
          if (isP2Pick) tagClass += ' tagP2';
          const tag = document.createElement('div');
          tag.className = tagClass;
          tag.textContent = badgeText;
          el.appendChild(tag);
        }
        drawPortrait(canvas, c);
      } else {
        // zárolt slot: fekete sziluett (CSS ::before/::after) + nagy kérdőjel + COMING SOON
        const sil = document.createElement('div');
        sil.className = 'csSilhouette';
        el.appendChild(sil);
        const q = document.createElement('div');
        q.className = 'csQmark';
        q.textContent = '?';
        el.appendChild(q);
        const nameEl = document.createElement('div');
        nameEl.className = 'slotName csComingSoon';
        nameEl.textContent = 'COMING SOON';
        el.appendChild(nameEl);
      }
      grid.appendChild(el);
    });
    highlightCharGridCursor(); // a VÉLETLEN gomb kiemelését is friss állapotba hozza (l. lent)
  }
  // lightweight cursor-highlight update: just toggles the 'cursor' class on existing elements,
  // no DOM rebuild — safe to call on every mouse hover and every keyboard nav step. Also kezeli a
  // rács alatti VÉLETLEN gomb kiemelését, amikor a kurzor a virtuális RANDOM_CURSOR_IDX-en áll.
  function highlightCharGridCursor(){
    document.querySelectorAll('#charGrid .charSlot').forEach(el=>{
      el.classList.toggle('cursor', !el.classList.contains('locked') && +el.dataset.idx === csCursor);
    });
    document.getElementById('charRandomBtn').classList.toggle('cursor', csCursor === RANDOM_CURSOR_IDX);
    if (csCursor !== RANDOM_CURSOR_IDX) csLastGridCursor = csCursor; // ide tér vissza a Fel a RANDOM gombról
    renderCsPreview(); // a jobb oldali preview panel mindig a kurzor alatti karaktert mutatja
  }

  // ---------- karakterválasztó: jobb oldali PREVIEW panel ----------
  // A kurzor alatti karakter nagy képe + statcsíkok + Ultimate név. Zárolt slotra vagy a RANDOM
  // gombra állva az utoljára mutatott karakter marad kint (nem villog üresre). A statok pusztán
  // vizuális jellemzők (CHAR_META), a harcrendszert nem befolyásolják.
  const CS_STAT_KEYS = ['POWER', 'SPEED', 'RANGE', 'DEFENSE', 'TECHNIQUE'];
  let csPreviewCharId = null; // csak valódi karakterváltáskor fusson a fade/slide + stat animáció
  function renderCsPreview(){
    const c = (csCursor >= 0 && csCursor < CHARACTERS.length) ? CHARACTERS[csCursor] : null;
    if (!c || !c.enabled || c.id === csPreviewCharId) return;
    csPreviewCharId = c.id;
    const meta = CHAR_META[c.id] || { stats: {}, ultName: '???' };
    document.getElementById('csPreviewName').textContent = c.name;
    document.getElementById('csUltName').textContent = meta.ultName;
    // statsorok újraépítése -- minden csík 0%-ról indul, és a következő frame-ben kapja meg a
    // valódi szélességét, így a CSS width-transition "animált feltöltésként" játssza le
    const statsEl = document.getElementById('csStats');
    statsEl.innerHTML = '';
    const fills = [];
    CS_STAT_KEYS.forEach(k => {
      const row = document.createElement('div');
      row.className = 'csStatRow';
      const lbl = document.createElement('div');
      lbl.className = 'csStatLabel';
      lbl.textContent = k;
      row.appendChild(lbl);
      const bar = document.createElement('div');
      bar.className = 'csStatBar';
      const fill = document.createElement('div');
      fill.className = 'csStatFill';
      fill.style.width = '0%';
      bar.appendChild(fill);
      row.appendChild(bar);
      statsEl.appendChild(row);
      fills.push([fill, Math.max(0, Math.min(10, meta.stats[k] || 0)) * 10]);
    });
    requestAnimationFrame(() => fills.forEach(([f, pct]) => { f.style.width = pct + '%'; }));
    // nagy karakterkép: a teljes idle sprite arányosan, alulra igazítva a preview vászonra
    const canvas = document.getElementById('csPreviewCanvas');
    if (canvas && canvas.getContext && typeof canvas.width === 'number'){
      const c2d = canvas.getContext('2d');
      c2d.clearRect(0, 0, canvas.width, canvas.height);
      const img = sprites[c.spriteKey] && sprites[c.spriteKey].idle;
      if (img && img.complete && img.naturalWidth){
        const s = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
        const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
        c2d.drawImage(img, (canvas.width - dw) / 2, canvas.height - dh, dw, dh);
      }
    }
    // finom fade/slide újraindítása karakterváltáskor (ugyanaz a reflow-trükk, mint a countdownnál)
    const panel = document.getElementById('csPreview');
    if (panel && panel.classList){
      panel.classList.remove('csAnimIn');
      void panel.offsetWidth;
      panel.classList.add('csAnimIn');
    }
  }
  // single delegated listener for both hover (mouseover bubbles, unlike mouseenter) and click —
  // works no matter how many times the slot elements underneath get rebuilt, since it's bound to
  // the grid container itself rather than to the (potentially short-lived) individual slot nodes.
  document.getElementById('charGrid').addEventListener('mouseover', e=>{
    const slot = e.target.closest('.charSlot');
    if (!slot || slot.classList.contains('locked')) return;
    const idx = +slot.dataset.idx;
    if (idx !== csCursor){ csCursor = idx; highlightCharGridCursor(); }
  });
  document.getElementById('charGrid').addEventListener('click', e=>{
    const slot = e.target.closest('.charSlot');
    if (!slot || slot.classList.contains('locked')) return;
    csCursor = +slot.dataset.idx;
    confirmCharSelect();
  });
  // a gomb egérrel is ugyanúgy fókuszba kerül (hover), mint a rács kártyái, majd kattintásra a
  // már meglévő confirmCharSelect()-en át fut (RANDOM_CURSOR_IDX ág) -- egyetlen közös útvonal
  // billentyűzetnek, gamepadnek és egérnek is.
  document.getElementById('charRandomBtn').addEventListener('mouseover', ()=>{
    if (csCursor !== RANDOM_CURSOR_IDX){ csCursor = RANDOM_CURSOR_IDX; highlightCharGridCursor(); }
  });
  document.getElementById('charRandomBtn').addEventListener('click', ()=>{
    csCursor = RANDOM_CURSOR_IDX;
    confirmCharSelect();
  });

  function renderVsScreen(){
    document.getElementById('vsLabelP1').textContent = 'P1 · ' + charName(p1CharId);
    document.getElementById('vsLabelP2').textContent = ((mode === '1p' || mode === 'training' || mode === 'arcade') ? 'CPU · ' : 'P2 · ') + charName(p2CharId);
    drawPortrait(document.getElementById('vsPortraitP1'), charById(p1CharId));
    drawPortrait(document.getElementById('vsPortraitP2'), charById(p2CharId));
  }
  // Most a pálya kiválasztása UTÁN fut le (lásd startBtn) -- a kiválasztott karakterekkel és a már
  // eldöntött pályával a háttérben megjeleníti az "ÖSSZECSAPÁS" feliratot egy röpke pillanatra,
  // aztán ez indítja el ténylegesen a mérkőzést.
  let vsScreenTimer = null;
  function enterVsScreen(){
    gameState = 'VS_SCREEN';
    // Lazy prewarm: both fighters and the chosen stage are decided by now (see startBtn).
    // The ~1.6s VS screen gives their sprites time to decode before the match begins.
    ensureFighterLoaded(p1CharId);
    ensureFighterLoaded(p2CharId);
    ensureStageLoaded(stage);
    renderVsScreen();
    showPanel('vsScreen');
    clearTimeout(vsScreenTimer);
    vsScreenTimer = setTimeout(()=>{
      if (gameState !== 'VS_SCREEN') return;
      document.getElementById('vsScreen').style.display = 'none';
      RoundManager.reset();
      resetGame();
      gameState = 'FIGHT';
      lastFrameTs = null;
      CountdownManager.start();
    }, 1600);
  }

  function enterStageSelect(){
    gameState = 'STAGE_SELECT';
    // a kurzor mindig a jelenleg érvényes választást mutatja belépéskor: ha random volt kiválasztva,
    // az utolsó (VÉLETLEN) kártyát emeli ki, egyébként a megfelelő pálya-kártyát
    stageCursor = stageIsRandom ? STAGE_LIST.length : STAGE_LIST.indexOf(stage);
    if (stageCursor < 0) stageCursor = 0;
    renderStageGrid();
    showPanel('menu');
  }
  // Builds the 4 stage-picker cards (one per STAGE_LIST entry + one "VÉLETLEN" card) -- each card's
  // thumbnail reuses the SAME already-loaded STAGE_DATA image the game draws as its in-match background,
  // so no extra image assets/bytes are needed just for the picker.
  function renderStageGrid(){
    const grid = document.getElementById('stageGrid');
    grid.innerHTML = '';
    STAGE_LIST.forEach((id, idx) => {
      const el = document.createElement('div');
      el.className = 'stageCard' + (!stageIsRandom && idx === stageCursor ? ' selected' : '');
      el.dataset.idx = idx;
      const thumb = document.createElement('img');
      thumb.className = 'stageThumb';
      thumb.src = STAGE_DATA[id];
      thumb.alt = STAGE_NAMES[id];
      el.appendChild(thumb);
      const nameEl = document.createElement('div');
      nameEl.className = 'stageName';
      nameEl.textContent = STAGE_NAMES[id];
      el.appendChild(nameEl);
      el.addEventListener('click', ()=>selectStage(idx));
      grid.appendChild(el);
    });
    // "VÉLETLEN" kártya -- a valódi sorsolás csak HARC!-kor történik (lásd startBtn), itt csak a
    // szándékot jelöljük ki, hogy minden induláskor friss legyen a véletlen választás
    const randomIdx = STAGE_LIST.length;
    const rc = document.createElement('div');
    rc.className = 'stageCard' + (stageIsRandom ? ' selected' : '');
    rc.dataset.idx = randomIdx;
    const icon = document.createElement('div');
    icon.className = 'stageRandomIcon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>';
    rc.appendChild(icon);
    const rcName = document.createElement('div');
    rcName.className = 'stageName';
    rcName.textContent = 'VÉLETLEN';
    rc.appendChild(rcName);
    rc.addEventListener('click', ()=>selectStage(randomIdx));
    grid.appendChild(rc);
  }
  // egységes belépési pont az összes vezérlési módhoz (egér, billentyűzet, gamepad) -- a kártya
  // kiválasztása egyben AZONNAL érvényesíti is a pályát (nincs külön "megerősítés" lépés, csak a
  // HARC! gomb indítja el ténylegesen a meccset, pontosan úgy, mint korábban az egér-kattintásnál)
  function selectStage(idx){
    stageCursor = idx;
    if (idx >= STAGE_LIST.length){
      stageIsRandom = true;
    } else {
      stageIsRandom = false;
      stage = STAGE_LIST[idx];
    }
    renderStageGrid();
  }
  document.getElementById('startBtn').addEventListener('click', ()=>{
    // ha a VÉLETLEN kártya volt kiválasztva, itt sorsolunk friss pályát -- minden induláskor újat,
    // akkor is, ha a játékos a menüben nem nyúlt semmihez a VÉLETLEN kiválasztása óta
    if (stageIsRandom) stage = STAGE_LIST[Math.floor(Math.random() * STAGE_LIST.length)];
    // a pálya már eldőlt -- most jöhet az "ÖSSZECSAPÁS" képernyő, ami rövid idő után magától
    // elindítja a mérkőzést (lásd enterVsScreen)
    enterVsScreen();
  });
  document.getElementById('stageBackBtn').addEventListener('click', goToMainMenu);
  document.getElementById('menuBtn').addEventListener('click', goToMainMenu);
  // Global top-right back button: reuse the exact keyboard Esc navigation, so it always does the
  // same "go back one screen" the game already defines per menu state (no separate logic to drift).
  const backNavEl = document.getElementById('backNav');
  backNavEl.addEventListener('click', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  // In-fight menu button (mobile): same Esc, which opens the pause menu during FIGHT (and resumes
  // from PAUSED) -- one place defines the behaviour, this just triggers it.
  const fightMenuEl = document.getElementById('fightMenuBtn');
  if (fightMenuEl) fightMenuEl.addEventListener('click', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  // ---------- INPUT ----------
  const KEYMAP = {
    p1left: ['a','A'], p1right: ['d','D'], p1up: ['w','W'], p1down: ['s','S'],
    p1punch: ['f','F'], p1kick: ['g','G'], p1special: ['r','R'], p1ultimate: ['q','Q'],
    p1block: ['e','E'],
    p1taunt: ['t','T'],
    p2left: ['ArrowLeft'], p2right: ['ArrowRight'], p2up: ['ArrowUp'], p2down: ['ArrowDown'],
    p2punch: [','], p2kick: ['.'], p2special: ['o','O'], p2ultimate: ['/'],
    p2block: ['l','L'],
    p2taunt: [';'],
  };
  function actionFromKey(k){
    for (const action in KEYMAP){ if (KEYMAP[action].includes(k)) return action; }
    return null;
  }
  const pressed = {};

  // ---------- MENU NAVIGATION (keyboard) ----------
  // handles MAIN_MENU / CHARACTER_SELECT / STAGE_SELECT; the FIGHT state uses the pressed{} map below instead
  function handleMenuKeydown(e){
    const k = e.key;
    if (gameState === 'MAIN_MENU'){
      if (mainMenuStep === 'modeList'){
        // Versus Mode, Arcade Mode és Training Mode közül old fel navigálni (Story továbbra is zárolt);
        // Enter/Space a kiemelt (modeListCursor) opciót választja ki. 3 elem, balra/fel eggyel vissza,
        // jobbra/le eggyel előre, körkörösen.
        if (k==='ArrowLeft'||k==='ArrowUp'||k==='a'||k==='A'||k==='w'||k==='W'){
          modeListCursor = (modeListCursor + 2) % 3;
          renderModeListCursor();
          e.preventDefault();
        } else if (k==='ArrowRight'||k==='ArrowDown'||k==='d'||k==='D'||k==='s'||k==='S'){
          modeListCursor = (modeListCursor + 1) % 3;
          renderModeListCursor();
          e.preventDefault();
        } else if (k==='Enter' || k===' '){
          if (modeListCursor === 1) startArcadeMode();
          else if (modeListCursor === 2) startTrainingMode();
          else { showMainMenuStep('versusSubmenu'); renderMainMenuCursor(); }
          e.preventDefault();
        }
      } else { // 'versusSubmenu'
        if (k==='ArrowUp'||k==='ArrowDown'||k==='ArrowLeft'||k==='ArrowRight'||k==='w'||k==='W'||k==='s'||k==='S'||k==='a'||k==='A'||k==='d'||k==='D'){
          mmCursor = 1 - mmCursor;
          renderMainMenuCursor();
          e.preventDefault();
        } else if (k==='Enter' || k===' '){
          confirmMainMenu();
          e.preventDefault();
        } else if (k==='Escape'){
          showMainMenuStep('modeList');
          e.preventDefault();
        }
      }
    } else if (gameState === 'DIFFICULTY_SELECT'){
      if (k==='ArrowUp'||k==='w'||k==='W'){ difficultyCursor = (difficultyCursor + AI_DIFFICULTY_LIST.length - 1) % AI_DIFFICULTY_LIST.length; renderDifficultyCursor(); e.preventDefault(); }
      else if (k==='ArrowDown'||k==='s'||k==='S'){ difficultyCursor = (difficultyCursor + 1) % AI_DIFFICULTY_LIST.length; renderDifficultyCursor(); e.preventDefault(); }
      else if (k==='Enter'||k===' '){ confirmDifficultySelect(); e.preventDefault(); }
      else if (k==='Escape'){ goToMainMenu(); e.preventDefault(); }
    } else if (gameState === 'CHARACTER_SELECT'){
      if (k==='ArrowLeft'||k==='a'||k==='A'){ moveCursor(-1,0); e.preventDefault(); }
      else if (k==='ArrowRight'||k==='d'||k==='D'){ moveCursor(1,0); e.preventDefault(); }
      else if (k==='ArrowUp'||k==='w'||k==='W'){ moveCursor(0,-1); e.preventDefault(); }
      else if (k==='ArrowDown'||k==='s'||k==='S'){ moveCursor(0,1); e.preventDefault(); }
      else if (k==='Enter'||k===' '||k==='f'||k==='F'){ confirmCharSelect(); e.preventDefault(); }
      else if (k==='Escape'){ goToMainMenu(); e.preventDefault(); }
    } else if (gameState === 'STAGE_SELECT'){
      const stageMax = STAGE_LIST.length; // utolsó index = VÉLETLEN kártya
      if (k==='Escape'){ goToMainMenu(); e.preventDefault(); }
      else if (k==='ArrowLeft'||k==='a'||k==='A'){ selectStage(Math.max(0, stageCursor-1)); e.preventDefault(); }
      else if (k==='ArrowRight'||k==='d'||k==='D'){ selectStage(Math.min(stageMax, stageCursor+1)); e.preventDefault(); }
      else if (k==='Enter'){ document.getElementById('startBtn').click(); e.preventDefault(); }
    } else if (gameState === 'MATCH_END'){
      if (k==='ArrowUp'||k==='ArrowDown'||k==='ArrowLeft'||k==='ArrowRight'||k==='w'||k==='W'||k==='s'||k==='S'||k==='a'||k==='A'||k==='d'||k==='D'){
        matchEndCursor = 1 - matchEndCursor; renderMatchEndCursor(); e.preventDefault();
      } else if (k==='Enter'||k===' '){ confirmMatchEndOption(); e.preventDefault(); }
      else if (k==='Escape'){ document.getElementById('menuBtn').click(); e.preventDefault(); }
    } else if (gameState === 'PAUSED'){
      if (pauseStep === 'main'){
        const n = currentPauseOptions().length;
        if (k==='Escape'){ resumeGame(); e.preventDefault(); }
        else if (k==='ArrowUp'||k==='w'||k==='W'){ pauseCursor = (pauseCursor + n - 1) % n; renderPauseCursor(); e.preventDefault(); }
        else if (k==='ArrowDown'||k==='s'||k==='S'){ pauseCursor = (pauseCursor + 1) % n; renderPauseCursor(); e.preventDefault(); }
        else if (k==='Enter'||k===' '){ confirmPauseOption(); e.preventDefault(); }
      } else { // 'cpuBehavior'
        const n = TRAINING_CPU_BEHAVIORS.length;
        if (k==='Escape'){ showPauseStep('main'); e.preventDefault(); }
        else if (k==='ArrowUp'||k==='w'||k==='W'){ cpuBehaviorCursor = (cpuBehaviorCursor + n - 1) % n; renderCpuBehaviorCursor(); e.preventDefault(); }
        else if (k==='ArrowDown'||k==='s'||k==='S'){ cpuBehaviorCursor = (cpuBehaviorCursor + 1) % n; renderCpuBehaviorCursor(); e.preventDefault(); }
        else if (k==='Enter'||k===' '){ confirmCpuBehaviorSelect(); e.preventDefault(); }
      }
    }
  }

  window.addEventListener('keydown', e=>{
    if (gameState === 'FIGHT' && e.key === 'Escape'){ pauseGame(); e.preventDefault(); return; }
    if (gameState !== 'FIGHT'){ handleMenuKeydown(e); return; }
    const action = actionFromKey(e.key);
    if (action){ pressed[action] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', e=>{
    const action = actionFromKey(e.key);
    if (action){ pressed[action] = false; e.preventDefault(); }
  });
  document.querySelectorAll('.tBtn').forEach(btn=>{
    const action = btn.dataset.key;
    const on = (e)=>{ pressed[action]=true; btn.classList.add('active'); e.preventDefault(); };
    const off = (e)=>{ pressed[action]=false; btn.classList.remove('active'); e.preventDefault(); };
    btn.addEventListener('touchstart', on, {passive:false});
    btn.addEventListener('touchend', off, {passive:false});
    btn.addEventListener('touchcancel', off, {passive:false});
    btn.addEventListener('mousedown', on);
    btn.addEventListener('mouseup', off);
    btn.addEventListener('mouseleave', off);
  });

  // ---------- ON-SCREEN MOVEMENT STICK (touch) ----------
  // A draggable analog stick that writes the SAME p1 direction actions as the keyboard/gamepad
  // (pressed.p1left/right/up/down). Because it can express diagonals, rolling it also performs the
  // motion-input specials (QCF/QCB). Multitouch-safe via touch identifier, so the stick and a fight
  // button can be held at the same time. A deadzone keeps a resting thumb from drifting into a input.
  (function initTouchStick(){
    const stick = document.getElementById('touchStick');
    const knob  = document.getElementById('touchStickKnob');
    if (!stick || !knob) return;
    const DZ = 0.30;                 // deadzone as a fraction of the stick radius
    let touchId = null, mouseActive = false;
    const clearDirs = () => { pressed.p1left = pressed.p1right = pressed.p1up = pressed.p1down = false; };
    const release = () => { touchId = null; mouseActive = false; clearDirs(); knob.style.transform = 'translate(0,0)'; };
    function moveTo(clientX, clientY){
      const r = stick.getBoundingClientRect();
      const rad = r.width / 2;
      let dx = (clientX - (r.left + rad)) / rad;
      let dy = (clientY - (r.top  + rad)) / rad;
      const mag = Math.hypot(dx, dy);
      if (mag > 1){ dx /= mag; dy /= mag; }                    // clamp the knob to the rim
      knob.style.transform = `translate(${dx * rad * 0.6}px, ${dy * rad * 0.6}px)`;
      pressed.p1left  = dx < -DZ;                              // per-axis threshold keeps diagonals available
      pressed.p1right = dx >  DZ;
      pressed.p1up    = dy < -DZ;
      pressed.p1down  = dy >  DZ;
    }
    stick.addEventListener('touchstart', e => {
      const t = e.changedTouches[0]; touchId = t.identifier; moveTo(t.clientX, t.clientY); e.preventDefault();
    }, {passive:false});
    window.addEventListener('touchmove', e => {
      if (touchId === null) return;
      for (const t of e.changedTouches){ if (t.identifier === touchId){ moveTo(t.clientX, t.clientY); e.preventDefault(); return; } }
    }, {passive:false});
    const endTouch = e => { if (touchId === null) return;
      for (const t of e.changedTouches){ if (t.identifier === touchId){ release(); return; } } };
    window.addEventListener('touchend', endTouch);
    window.addEventListener('touchcancel', endTouch);
    // mouse fallback so the stick is testable on desktop too
    stick.addEventListener('mousedown', e => { mouseActive = true; moveTo(e.clientX, e.clientY); e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (mouseActive) moveTo(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (mouseActive) release(); });
  })();

  // ---------- GAMEPAD MANAGER (DualSense + future controllers) ----------
  // Generic, profile-driven gamepad support built on the browser's native Gamepad API. It feeds the
  // SAME pressed{} action-map that keyboard input already writes into above (and that the on-screen
  // touch buttons already write into too, see .tBtn wiring right above) -- so getInput()/ATTACKS/the
  // menu handlers below needed ZERO changes to gain controller support. This was the whole point of
  // KEYMAP/pressed{} already being action-based (p1left/p1punch/... instead of raw key codes).
  //
  // Auto-detection & assignment: re-derived fresh every frame from navigator.getGamepads() (plus the
  // gamepadconnected/disconnected events as a fast-path) -- 0 pads: both players stay on keyboard.
  // 1 pad: Player 1 gets it, Player 2 stays on keyboard. 2 pads: Player 1 gets the lowest-index pad,
  // Player 2 gets the other. Fully live: plugging/unplugging mid-session re-assigns immediately, and
  // any player who loses their pad has their pressed{} flags cleared so nothing gets stuck "held down".
  //
  // Extensibility:
  //   - New controller type (Xbox, Switch Pro, ...): add one more entry to GAMEPAD_PROFILES with its
  //     own button/axis indices, and point detectGamepadProfile() at it for that device -- everything
  //     else (assignment, polling, menu nav, FIGHT input) is already generic. In practice most modern
  //     pads (DualSense included) report as the W3C "standard" gamepad layout, so today's single
  //     'standard' profile already covers them.
  //   - Custom button mapping (Controls menu): GAMEPAD_PROFILES.standard is the single source of truth
  //     for which button index means what -- a future settings UI just needs to write a per-user copy
  //     of this object instead of the hardcoded one.
  //   - Vibration / adaptive triggers: GamepadManager._padFor(prefix) already hands back the live
  //     Gamepad object for a player, which is all navigator.getGamepads()[i].vibrationActuator.
  //     playEffect(...) needs -- no plumbing left to add.
  const GAMEPAD_PROFILES = {
    // W3C "standard" gamepad button layout -- DualSense, DualShock 4, Xbox pads and most controllers
    // Chrome/Edge/Firefox expose with gamepad.mapping === 'standard' all share these same indices.
    standard: {
      faceDown: 0,  // Cross (PS) / A (Xbox)     -> Ugrás (jump)
      faceRight: 1, // Circle (PS) / B (Xbox)    -> (jövőbeli fogás) / menüben: Vissza
      faceLeft: 2,  // Square (PS) / X (Xbox)    -> Ütés (punch)
      faceUp: 3,    // Triangle (PS) / Y (Xbox)  -> Rúgás (kick)
      l1: 4,        // L1 / LB                   -> Berserk
      r1: 5,        // R1 / RB                   -> Ultimate
      l2: 6,        // L2 / LT                   -> Block (High Block / Crouch Blockkal kombinálva Le-vel)
      r3: 11,       // R3 (jobb analóg kar benyomása)  -> Taunt
      options: 9,   // Options (PS) / Menu (Xbox) -> Szünet (ugyanaz, mint az Escape billentyű)
      dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
      axisX: 0, axisY: 1, // bal analóg kar
    },
  };
  function detectGamepadProfile(gp){
    // ma minden felismert (mapping:'standard') pad -- DualSense is -- ugyanazt a kiosztást kapja; a
    // gp.id itt csak azért van megőrizve, hogy egy jövőbeli, nem-standard eszköz saját profilt kaphasson
    // anélkül, hogy a hívási helyeken (poll/menü-nav) bármit módosítani kelljen.
    return GAMEPAD_PROFILES.standard;
  }
  const GAMEPAD_DEADZONE = 0.35;
  const GAMEPAD_ACTIONS = ['left','right','up','down','punch','kick','special','ultimate','block','taunt'];
  const GamepadManager = {
    assigned: { p1: null, p2: null }, // gamepad.index vagy null, játékosonként
    _menuNavPrev: null,               // előző képkocka nav-állapota (P1 padja hajtja a menüket)
    _optionsPrev: { p1: false, p2: false }, // él-érzékeléshez az Options/Menu gombhoz (szünet FIGHT alatt)
    init(){
      window.addEventListener('gamepadconnected', ()=>this._reassign());
      window.addEventListener('gamepaddisconnected', ()=>this._reassign());
      this._reassign();
    },
    _clearPressed(prefix){
      GAMEPAD_ACTIONS.forEach(a=>{ pressed[prefix+a] = false; });
      this._optionsPrev[prefix] = false; // új/lecserélt padon a kezdő állapot mindig "nincs nyomva"
    },
    _reassign(){
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(p=>p) : [];
      pads.sort((a,b)=>a.index-b.index);
      const newP1 = pads[0] ? pads[0].index : null;
      const newP2 = pads[1] ? pads[1].index : null;
      if (newP1 !== this.assigned.p1) this._clearPressed('p1');
      if (newP2 !== this.assigned.p2) this._clearPressed('p2');
      this.assigned.p1 = newP1;
      this.assigned.p2 = newP2;
    },
    _padFor(prefix){
      const idx = this.assigned[prefix];
      if (idx === null || idx === undefined) return null;
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      return pads[idx] || null;
    },
    isUsingGamepad(prefix){ return this._padFor(prefix) !== null; },
    // hívva minden animációs képkockán, gameState-től függetlenül -- FIGHT alatt a pressed{} térképet
    // frissíti (ugyanúgy, mint a billentyűzet), minden más állapotban (menük) az él-érzékelt navigációt.
    poll(){
      if (!navigator.getGamepads) return;
      this._reassign(); // biztonsági újraellenőrzés minden képkockán (néhány böngésző nem tüzeli megbízhatóan a connected eseményt)
      for (const prefix of ['p1','p2']){
        const pad = this._padFor(prefix);
        if (!pad) continue;
        const profile = detectGamepadProfile(pad);
        const b = pad.buttons;
        const btn = (i) => !!(b[i] && b[i].pressed);
        const axisX = pad.axes[profile.axisX] || 0;
        const axisY = pad.axes[profile.axisY] || 0;
        const navLeft  = btn(profile.dpadLeft)  || axisX < -GAMEPAD_DEADZONE;
        const navRight = btn(profile.dpadRight) || axisX >  GAMEPAD_DEADZONE;
        const navUp    = btn(profile.dpadUp)    || axisY < -GAMEPAD_DEADZONE;
        const navDown  = btn(profile.dpadDown)  || axisY >  GAMEPAD_DEADZONE;
        const jumpBtn  = btn(profile.faceDown);   // Cross -> Ugrás
        const punchBtn = btn(profile.faceLeft);   // Square -> Ütés
        const kickBtn  = btn(profile.faceUp);     // Triangle -> Rúgás
        const backBtn  = btn(profile.faceRight);  // Circle -> (harcban egyenlőre semmi) / menüben Vissza
        const specialBtn  = btn(profile.l1);      // L1 -> Berserk
        const ultimateBtn = btn(profile.r1);      // R1 -> Ultimate
        const blockBtn    = btn(profile.l2);      // L2 -> Block (High Block / Le-vel kombinálva Crouch Block)
        const tauntBtn    = btn(profile.r3);      // R3 -> Taunt (tisztán kozmetikai)
        const optionsBtn  = btn(profile.options); // Options (PS) / Menu (Xbox) -> Szünet
        // Él-érzékelés: az ELŐZŐ képkocka állapotát kell megnézni, mielőtt felülírnánk -- különben
        // lenyomva tartva minden képkockán újra "friss nyomásnak" tűnne.
        const optionsJustPressed = optionsBtn && !this._optionsPrev[prefix];
        this._optionsPrev[prefix] = optionsBtn;

        if (gameState === 'FIGHT'){
          pressed[prefix+'left']  = navLeft;
          pressed[prefix+'right'] = navRight;
          pressed[prefix+'up']    = navUp || jumpBtn;   // bal kar/D-Pad fel VAGY Cross is ugrás
          pressed[prefix+'down']  = navDown;
          pressed[prefix+'punch'] = punchBtn;
          pressed[prefix+'kick']  = kickBtn;
          pressed[prefix+'special']  = specialBtn;
          pressed[prefix+'ultimate'] = ultimateBtn;
          pressed[prefix+'block']    = blockBtn;
          pressed[prefix+'taunt']    = tauntBtn;
          // Options gomb = Escape: bármelyik játékos padja szüneteltetheti a meccset, ugyanúgy mint
          // a billentyűzet Escape gombja.
          if (optionsJustPressed) pauseGame();
        } else if (gameState === 'PAUSED' && optionsJustPressed){
          // Options gomb szünet alatt is működjön, mint az Escape (folytatás)
          resumeGame();
        }

        // ---- menü navigáció: él-érzékelt (egy lépés/nyomás), mindig a Player 1 padja vezérli ----
        if (prefix === 'p1' && gameState !== 'FIGHT'){
          this._handleMenuNav({ navLeft, navRight, navUp, navDown, confirm: jumpBtn, back: backBtn });
        }
      }
    },
    _handleMenuNav(cur){
      const prev = this._menuNavPrev || { navLeft:false, navRight:false, navUp:false, navDown:false, confirm:false, back:false };
      const pressedNow = (k) => cur[k] && !prev[k]; // csak az első képkockán "true", amikor lenyomják
      if (gameState === 'MAIN_MENU'){
        if (mainMenuStep === 'modeList'){
          // Versus Mode, Arcade Mode és Training Mode közül navigálhat, confirm a kiemelt opciót választja ki
          if (pressedNow('navLeft') || pressedNow('navUp')){
            modeListCursor = (modeListCursor + 2) % 3; renderModeListCursor();
          }
          if (pressedNow('navRight') || pressedNow('navDown')){
            modeListCursor = (modeListCursor + 1) % 3; renderModeListCursor();
          }
          if (pressedNow('confirm')){
            if (modeListCursor === 1) startArcadeMode();
            else if (modeListCursor === 2) startTrainingMode();
            else { showMainMenuStep('versusSubmenu'); renderMainMenuCursor(); }
          }
        } else { // 'versusSubmenu'
          if (pressedNow('navUp') || pressedNow('navDown') || pressedNow('navLeft') || pressedNow('navRight')){
            mmCursor = 1 - mmCursor; renderMainMenuCursor();
          }
          if (pressedNow('confirm')) confirmMainMenu();
          if (pressedNow('back')) showMainMenuStep('modeList');
        }
      } else if (gameState === 'DIFFICULTY_SELECT'){
        if (pressedNow('navUp')){ difficultyCursor = (difficultyCursor + AI_DIFFICULTY_LIST.length - 1) % AI_DIFFICULTY_LIST.length; renderDifficultyCursor(); }
        if (pressedNow('navDown')){ difficultyCursor = (difficultyCursor + 1) % AI_DIFFICULTY_LIST.length; renderDifficultyCursor(); }
        if (pressedNow('confirm')) confirmDifficultySelect();
        if (pressedNow('back')) goToMainMenu();
      } else if (gameState === 'CHARACTER_SELECT'){
        if (pressedNow('navLeft')) moveCursor(-1,0);
        if (pressedNow('navRight')) moveCursor(1,0);
        if (pressedNow('navUp')) moveCursor(0,-1);
        if (pressedNow('navDown')) moveCursor(0,1);
        if (pressedNow('confirm')) confirmCharSelect();
        if (pressedNow('back')) goToMainMenu();
      } else if (gameState === 'STAGE_SELECT'){
        const stageMax = STAGE_LIST.length; // utolsó index = VÉLETLEN kártya
        if (pressedNow('navLeft')) selectStage(Math.max(0, stageCursor-1));
        if (pressedNow('navRight')) selectStage(Math.min(stageMax, stageCursor+1));
        if (pressedNow('confirm')) document.getElementById('startBtn').click();
        if (pressedNow('back')) goToMainMenu();
      } else if (gameState === 'MATCH_END'){
        if (pressedNow('navUp') || pressedNow('navDown') || pressedNow('navLeft') || pressedNow('navRight')){
          matchEndCursor = 1 - matchEndCursor; renderMatchEndCursor();
        }
        if (pressedNow('confirm')) confirmMatchEndOption();
        if (pressedNow('back')) document.getElementById('menuBtn').click();
      } else if (gameState === 'PAUSED'){
        if (pauseStep === 'main'){
          const n = currentPauseOptions().length;
          if (pressedNow('navUp')){ pauseCursor = (pauseCursor + n - 1) % n; renderPauseCursor(); }
          if (pressedNow('navDown')){ pauseCursor = (pauseCursor + 1) % n; renderPauseCursor(); }
          if (pressedNow('confirm')) confirmPauseOption();
          if (pressedNow('back')) resumeGame();
        } else { // 'cpuBehavior'
          const n = TRAINING_CPU_BEHAVIORS.length;
          if (pressedNow('navUp')){ cpuBehaviorCursor = (cpuBehaviorCursor + n - 1) % n; renderCpuBehaviorCursor(); }
          if (pressedNow('navDown')){ cpuBehaviorCursor = (cpuBehaviorCursor + 1) % n; renderCpuBehaviorCursor(); }
          if (pressedNow('confirm')) confirmCpuBehaviorSelect();
          if (pressedNow('back')) showPauseStep('main');
        }
      }
      this._menuNavPrev = cur;
    },
  };

  function banner(text, ms){
    const el = document.getElementById('banner');
    el.textContent = text;
    el.classList.add('show');
    bannerTimer = ms;
  }

  // ---------- AI ----------
    // ---------- CPU AI (difficulty-driven, state-based decision system) ----------
  // Every difficulty knob lives ONLY in this one config -- nothing below (or anywhere else) reads
  // pressed{} or any other raw input for the CPU. It only ever looks at fighter state that's
  // genuinely visible in the game world: distance, whether an attack is playing and which phase
  // it's in (startup/active/recovery, via attackCfg + attackTimer), onGround, blocking, hp, mana/
  // Ultimate availability, and its OWN combo state. Reaction time is simulated for real: a
  // freshly-observed event (opponent starts attacking, opponent's attack just became punishable)
  // is only acted on after reactionTime (+/- jitter) has actually elapsed -- so even Insane never
  // "reads" a button the instant it's pressed, it just reacts unusually fast and rarely misjudges.
  const AI_DIFFICULTY = {
    easy: {
      label: 'EASY',
      reactionTime: 500, reactionJitter: 220, // ms -- slow, inconsistent reflexes; leaves the player time to react
      decisionInterval: 650,                   // ms -- re-plans its overall gameplan rarely
      blockChance: 0.15,     // ritkán blokkol
      comboChance: 0.25,     // rövid kombókat használ (ritkán viszi végig)
      mistakeChance: 0.35,   // gyakran hibázik / néha rossz távolságból támad
      punishChance: 0.15,    // ritkán bünteti a hibákat
      berserkChance: 0.15, ultimateChance: 0.10, // ritkán használ Berserket/Ultimate-et
      aggression: 0.35, spacingNoise: 40,
    },
    normal: {
      label: 'NORMAL',
      reactionTime: 300, reactionJitter: 130, decisionInterval: 420,
      blockChance: 0.38,     // néha blokkol
      comboChance: 0.55,     // 2-3 ütéses kombók
      mistakeChance: 0.16,   // nem reagál tökéletesen minden támadásra
      punishChance: 0.35,
      berserkChance: 0.35, ultimateChance: 0.30, // időnként Berserk/Ultimate
      aggression: 0.50, spacingNoise: 20,        // alapvető távolságtartás
    },
    hard: {
      label: 'HARD',
      reactionTime: 160, reactionJitter: 60, decisionInterval: 260,
      blockChance: 0.62,     // gyakrabban blokkol
      comboChance: 0.80,     // megbízhatóan kombóz
      mistakeChance: 0.07,   // ritkábban hibázik
      punishChance: 0.65,    // bünteti az elhibázott támadásokat
      berserkChance: 0.55, ultimateChance: 0.55, // megfelelő pillanatban Berserk/Ultimate
      aggression: 0.62, spacingNoise: 8,          // jól kezeli a távolságot
    },
    insane: {
      label: 'INSANE',
      reactionTime: 90, reactionJitter: 35, decisionInterval: 170, // nagyon gyors, de nem 0/csaló
      blockChance: 0.78,     // gyakran blokkol és visszatámad
      comboChance: 0.92,     // hosszabb kombók is
      mistakeChance: 0.03,   // csak nagyon ritkán hibázik
      punishChance: 0.88,    // agresszíven bünteti a hibákat
      berserkChance: 0.70, ultimateChance: 0.70, // okosan használja a speciális képességeket
      aggression: 0.70, spacingNoise: 3,          // jól kezeli a távolságot és a pozíciót
    },
  };
  const AI_DIFFICULTY_LIST = ['easy', 'normal', 'hard', 'insane']; // sorrend a nehézség-választóhoz
  function aiCfg(f){ return AI_DIFFICULTY[f.difficulty] || AI_DIFFICULTY.normal; }

  // weighted random pick among named options -- e.g. {approach:2, retreat:0.5, light:3} picks
  // 'light' with probability 3/(2+0.5+3). Entries with weight <= 0 are never chosen.
  function aiWeightedPick(weights){
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    if (entries.length === 0) return null;
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of entries){ r -= w; if (r <= 0) return k; }
    return entries[entries.length - 1][0];
  }

  // Turns a chosen high-level action into concrete plan flags. Movement/block are HELD until the
  // next decision or reaction (like a human holding a direction/guard); punch/kick are one-frame
  // PULSES so the edge-triggered combo system (see ComboManager) sees a fresh press each time,
  // exactly like a human tapping the button rather than holding it down.
  function aiApplyAction(f, action, dist, cfg){
    const ai = f.ai;
    ai.plan.left = false; ai.plan.right = false; ai.plan.down = false; ai.plan.up = false;
    ai.plan.special = false; ai.plan.ultimate = false; ai.plan.block = false;
    if (action === 'approach'){ if (dist < 0) ai.plan.left = true; else ai.plan.right = true; }
    else if (action === 'retreat'){ if (dist < 0) ai.plan.right = true; else ai.plan.left = true; }
    else if (action === 'block'){ ai.plan.block = true; } // High Block
    else if (action === 'crouchBlock'){ ai.plan.block = true; ai.plan.down = true; } // Crouch Block
    else if (action === 'light'){ ai.plan.punch = true; ai.comboFollowUp = Math.random() < cfg.comboChance; }
    else if (action === 'heavy'){ ai.plan.kick = true; ai.comboFollowUp = Math.random() < cfg.comboChance; }
    else if (action === 'sweep'){ ai.plan.down = true; ai.plan.kick = true; } // Le + Heavy
    else if (action === 'throw'){ ai.plan.punch = true; ai.plan.kick = true; } // Light + Heavy egyszerre
    else if (action === 'backThrow'){
      // Throw Direction System: Light + Heavy EGYSZERRE, a facing-hez képest HÁTRA-iránnyal tartva --
      // pontosan úgy, ahogy egy ember is a hátra gombot nyomná a dobás indításának pillanatában.
      ai.plan.punch = true; ai.plan.kick = true;
      if (f.facing === 1) ai.plan.left = true; else ai.plan.right = true;
    }
    else if (action === 'jump'){ ai.plan.up = true; }
    else if (action === 'berserk'){ ai.plan.special = true; }
    else if (action === 'ultimate'){ ai.plan.ultimate = true; }
    // 'hold' (or anything unrecognized) -> no movement/attack, just stands and reassesses next cycle
  }

  // The dynamic, weighted "what should I do right now" decision -- this is what makes the CPU feel
  // situational instead of scripted: every weight below is shaped by difficulty (cfg), the current
  // distance, and the live combat situation (own/opponent HP, whether Berserk/Ultimate are ready,
  // whether the opponent is airborne, etc.), then one action is rolled from the resulting weights.
  function aiBaselineDecision(f, other, cfg, dist, absDist){
    // Mistake roll: instead of the weighted "smart" pick, do something careless -- attack from a bad
    // range, approach when retreating would be safer, whatever a distracted player might do. This is
    // the one mechanism behind "gyakran hibázik" / "néha rossz távolságból támad" at every level,
    // just gated by a difficulty-specific probability -- so higher difficulty is purely about making
    // BETTER decisions less often wrong, never about extra damage or speed multipliers.
    if (Math.random() < cfg.mistakeChance){
      const clumsy = ['approach', 'retreat', 'light', 'heavy', 'hold'][Math.floor(Math.random()*5)];
      aiApplyAction(f, clumsy, dist, cfg);
      return;
    }

    const otherAirborne = !other.onGround;
    const canBerserk = f.manaMs >= f.manaFillMs && f.berserkActive <= 0 && f.attackTimer <= 0;
    const canUlt = canUseUltimate(f);
    const otherHpFrac = other.hp / other.maxHp;
    // spacingNoise fuzzes the ideal-range judgement a little so lower difficulties aren't always
    // attacking from the mathematically perfect distance the way Hard/Insane reliably do
    const rangedDist = absDist + (Math.random()*2 - 1) * cfg.spacingNoise;

    const w = { approach: 0, retreat: 0, block: 0, light: 0, heavy: 0, sweep: 0, throw: 0, backThrow: 0, jump: 0, berserk: 0, ultimate: 0, hold: 0.3 };

    if (rangedDist > 90) w.approach = 2.2 + cfg.aggression * 2.2;
    else if (rangedDist < 26) w.retreat = 0.9 + (1 - cfg.aggression) * 1.4;
    else { w.approach = 0.6 + cfg.aggression; w.retreat = 0.3; }

    // Throw Direction System (AI): a CPU akkor "cornered", ha ő maga van a pálya szélének közelében --
    // ilyenkor a Back Throw kifejezetten taktikai előny, mert valódi oldalváltással kihozza a sarokból
    // (az ellenfél kerül a sarokba, ő pedig a pálya közepe felé). Nyílt pályán ritka, csak egy apró
    // esély marad rá -- pont ahogy a kérés mondja: "nem kell gyakran, de legyen rá esélye".
    const cornered = f.x < 70 || f.x > (W - f.w - 70);
    const freeToAct = f.attackTimer <= 0 && f.throwTimer <= 0;
    if (freeToAct && !otherAirborne){
      if (rangedDist < 48) w.light = 2.4;
      if (rangedDist >= 36 && rangedDist < 72) w.heavy = 1.9;
      // Sweep / Throw: közeli, low-attack / grab mixup -- a difficulty aggression-je szabja meg,
      // mennyire keveri be ezeket a magasabb szintű CPU (NEM extra sebzés, csak több eszköz/döntés)
      if (rangedDist < 40) w.throw = 0.5 + cfg.aggression * 0.6;
      if (rangedDist < 40) w.backThrow = (0.1 + cfg.aggression * 0.12) * (cornered ? 4 : 1);
      if (rangedDist < 50) w.sweep = 0.45 + cfg.aggression * 0.5;
    }
    // idle defensive posture when close but nothing urgent is happening yet -- the PRIMARY way this
    // AI blocks a telegraphed attack is the reaction system below, this is just a light supplement
    if (absDist < 60 && other.attackTimer <= 0) w.block = cfg.blockChance * 0.4;

    if (canBerserk) w.berserk = cfg.berserkChance * 2.2 * (otherHpFrac < 0.35 ? 1.4 : 1);
    if (canUlt && absDist < 170 && f.attackTimer <= 0) w.ultimate = cfg.ultimateChance * 2.2 * (otherHpFrac < 0.45 ? 1.6 : 1);
    w.jump = 0.12 + cfg.aggression * 0.1;

    aiApplyAction(f, aiWeightedPick(w) || 'hold', dist, cfg);
  }

  // Called every frame (with real dt) whenever mode === '1p' and this is p2's turn to act. Returns
  // the SAME kind of {left,right,up,down,punch,kick,special,ultimate,block} action object a human's
  // pressed{} map would produce -- the rest of the engine (updateFighter, ComboManager, ...) can't
  // tell the difference, which is exactly what keeps the CPU honest: it can only ever act through
  // this one normal input channel, never by reaching into game internals to force an outcome.
  function aiThink(f, other, dt){
    const cfg = aiCfg(f);
    const ai = f.ai;
    ai.plan.punch = false; ai.plan.kick = false; // one-frame pulses -- always start this frame clear

    const dist = other.x - f.x;
    const absDist = Math.abs(dist);

    // ---- event detection: only ever reads OTHER's observable animation/physics state (never
    // pressed{}) -- "aktuális animáció, támadás elindult-e, levegőben van-e" ---- most már a Throw
    // saját idővonalát (throwTimer/THROW_CFG) is figyeli, nem csak a sima attackTimer-t.
    const otherAtkCfg = other.attackTimer > 0 ? other.attackCfg : (other.throwTimer > 0 ? THROW_CFG : null);
    const otherAtkTimer = other.attackTimer > 0 ? other.attackTimer : other.throwTimer;
    const otherAttacking = !!otherAtkCfg;
    const otherInRecovery = otherAttacking &&
      (attackDuration(otherAtkCfg) - otherAtkTimer) > (otherAtkCfg.startup + otherAtkCfg.active);

    if (otherAttacking && !ai.lastOtherAttacking && !otherInRecovery && !ai.reaction){
      // opponent JUST started a new attack -- decide (once, right now) whether this CPU will even
      // attempt to block it, then queue the reaction to actually fire after reactionTime elapses.
      // A Throw sosem blokkolható -- azt egyszerűen nem próbálja kivédeni (mint egy valódi játékos,
      // aki csak elviseli, vagy előre kitámad -- a "throw tech" egyelőre nincs implementálva).
      const incomingAtkType = otherAtkCfg.atkType || 'high';
      if (incomingAtkType !== 'throw' && Math.random() < cfg.blockChance && absDist < 100){
        ai.reaction = {
          kind: 'block',
          guard: incomingAtkType === 'low' ? 'crouch' : 'high', // High Attack -> High Block, Low/Sweep -> Crouch Block
          dueIn: cfg.reactionTime + (Math.random()*2-1) * cfg.reactionJitter,
        };
      }
    }
    if (otherInRecovery && !ai.lastOtherInRecovery && !ai.reaction){
      // opponent's attack (vagy Throw) just became punishable (past its active frames, still recovering)
      if (Math.random() < cfg.punishChance && absDist < 110){
        ai.reaction = { kind: 'punish', dueIn: cfg.reactionTime + (Math.random()*2-1) * cfg.reactionJitter };
      }
    }
    ai.lastOtherAttacking = otherAttacking;
    ai.lastOtherInRecovery = otherInRecovery;

    // ---- resolve a pending reaction once its simulated delay has actually elapsed ----
    if (ai.reaction){
      ai.reaction.dueIn -= dt;
      if (ai.reaction.dueIn <= 0){
        const kind = ai.reaction.kind;
        const guard = ai.reaction.guard;
        ai.reaction = null;
        if (kind === 'block'){
          aiApplyAction(f, guard === 'crouch' ? 'crouchBlock' : 'block', dist, cfg);
          ai.holdTimer = 260; // ms -- keep guarding briefly rather than instantly letting go
        } else if (kind === 'punish' && f.attackTimer <= 0 && f.throwTimer <= 0){
          aiApplyAction(f, absDist < 48 ? 'light' : 'heavy', dist, cfg);
        }
        return ai.plan;
      }
    }

    // ---- own combo follow-up: reads ONLY this fighter's own combo state (never the opponent's) --
    // exactly the kind of "current animation" self-state a player's own reflexes would use ----
    if (f.combo.def && f.combo.windowOpen && !ai.lastComboWindowOpen && ai.comboFollowUp){
      const def = f.combo.def;
      const nextIdx = f.combo.step + 1;
      if (nextIdx < def.hits.length){
        ai.plan[def.input[nextIdx]] = true;
        ai.lastComboWindowOpen = f.combo.windowOpen;
        return ai.plan;
      }
    }
    ai.lastComboWindowOpen = f.combo.windowOpen;

    // ---- keep holding a short reaction stance (e.g. the block above) until it expires ----
    if (ai.holdTimer > 0){
      ai.holdTimer -= dt;
      return ai.plan;
    }

    // ---- baseline periodic re-plan: approach/retreat/block/light/heavy/sweep/throw/jump/berserk/ultimate ----
    ai.decisionTimer -= dt;
    if (ai.decisionTimer <= 0){
      ai.decisionTimer = cfg.decisionInterval * (0.7 + Math.random()*0.6);
      aiBaselineDecision(f, other, cfg, dist, absDist);
    }
    return ai.plan;
  }

  // ---------- TRAINING MODE: fixed, non-adaptive CPU behaviors ----------
  // NEM az aiThink súlyozott döntési rendszerét használja -- egyszerű, kiszámítható "edzőbábu"
  // viselkedést játszik le folyamatosan, a Szünet menüből (CPU VISELKEDÉS) kiválasztott 4 mód
  // egyikét: Mozdulatlan / Védekező (High Block) / Alsó Védekező (Crouch Block) / Támadó
  // (folyamatos ütés/rúgás, amint szabad hozzá). Ugyanazon a normál input-csatornán (ai.plan) megy
  // át és ugyanazt az aiApplyAction()-t hívja, mint aiThink, így updateFighter/ComboManager stb.
  // semmit nem tud a különbségről -- pontosan úgy, mint egy emberi input.
  function trainingCpuThink(f, other, dt){
    const ai = f.ai;
    ai.plan.punch = false; ai.plan.kick = false; // one-frame pulses -- mindig friss képkockán indulnak
    const cfg = aiCfg(f);
    if (trainingCpuBehavior === 'block'){
      aiApplyAction(f, 'block', 0, cfg); // High Block, folyamatosan tartva
    } else if (trainingCpuBehavior === 'crouchBlock'){
      aiApplyAction(f, 'crouchBlock', 0, cfg); // Crouch Block, folyamatosan tartva
    } else if (trainingCpuBehavior === 'attack'){
      // amint szabad újra cselekedni, azonnal újabb ütést/rúgást indít -- egyszerű, folyamatos
      // támadó "edzőbábu", nem próbál se blokkolni, se hátrálni
      if (f.attackTimer <= 0 && f.throwTimer <= 0 && !isInvulnerable(f)){
        aiApplyAction(f, Math.random() < 0.5 ? 'light' : 'heavy', other.x - f.x, cfg);
      } else {
        aiApplyAction(f, 'hold', 0, cfg);
      }
    } else { // 'still' -- Mozdulatlan: se mozgás, se támadás, se blokk
      aiApplyAction(f, 'hold', 0, cfg);
    }
    return ai.plan;
  }

  function getInput(prefix, f, other, dt){
    if ((mode === '1p' || mode === 'arcade') && prefix === 'p2'){
      return aiThink(f, other, dt);
    }
    if (mode === 'training' && prefix === 'p2'){
      return trainingCpuThink(f, other, dt);
    }
    return {
      left: !!pressed[prefix+'left'], right: !!pressed[prefix+'right'],
      up: !!pressed[prefix+'up'], down: !!pressed[prefix+'down'],
      punch: !!pressed[prefix+'punch'], kick: !!pressed[prefix+'kick'],
      special: !!pressed[prefix+'special'], ultimate: !!pressed[prefix+'ultimate'],
      block: !!pressed[prefix+'block'],
      taunt: !!pressed[prefix+'taunt'],
    };
  }

  // ---------- MOTION INPUTS (optional special-move execution) ----------
  // Structure adapted from a Street Fighter II clone's ControlHistory: facing-relative
  // direction/button "tokens" are fed into a per-move cursor that advances on each matching
  // step and fires when it reaches the end. It's an EXTRA path to the specials this game
  // already has -- the single Ultimate/Berserk buttons keep working untouched, so casual
  // players lose nothing. Keyboard, gamepad and the on-screen touch d-pad all feed it the
  // same `input` object, so it works everywhere for free, and it needs no new sprites.
  const MOTION_STALL_MS = 500; // max gap between steps before a partial motion resets
  const SPECIAL_MOVES = [
    { name: 'ultimate', seq: ['down', 'downForward', 'forward', 'punch'] }, // quarter-circle forward + Punch
    { name: 'berserk',  seq: ['down', 'downBack', 'back', 'punch'] },       // quarter-circle back + Punch
  ];
  function makeMotion(){
    return { cursors: SPECIAL_MOVES.map(() => 0), stamp: SPECIAL_MOVES.map(() => -1e9), lastDir: null, fired: null };
  }
  // Current facing-relative direction token (or null for neutral).
  function motionDir(f, input){
    const fwd  = f.facing === 1 ? input.right : input.left;
    const back = f.facing === 1 ? input.left  : input.right;
    if (input.down && fwd)  return 'downForward';
    if (input.down && back) return 'downBack';
    if (input.down)         return 'down';
    if (input.up)           return 'up';
    if (fwd)                return 'forward';
    if (back)               return 'back';
    return null;
  }
  // Feed one token to every move's cursor with two leniencies: "skip one" (a keyboard player
  // may omit the diagonal) and "restart on the opening token". A step gap longer than
  // MOTION_STALL_MS drops the partial motion back to the start.
  function motionPush(m, token, nowMs){
    for (let i = 0; i < SPECIAL_MOVES.length; i++){
      const seq = SPECIAL_MOVES[i].seq;
      let c = (nowMs - m.stamp[i] > MOTION_STALL_MS) ? 0 : m.cursors[i];
      if (token === seq[c])          c += 1;
      else if (token === seq[c + 1]) c += 2;
      else                           c = (token === seq[0]) ? 1 : 0;
      m.stamp[i] = nowMs;
      if (c >= seq.length){ m.fired = SPECIAL_MOVES[i].name; c = 0; }
      m.cursors[i] = c;
    }
  }
  // Called once per frame per HUMAN fighter, before its action logic reads f.motion.fired.
  function motionUpdate(f, input, nowMs){
    const m = f.motion;
    m.fired = null;
    const d = motionDir(f, input);
    if (d !== m.lastDir){ m.lastDir = d; if (d) motionPush(m, d, nowMs); } // push on a fresh direction change
    if (input.punch && !f._prevInput.punch) motionPush(m, 'punch', nowMs);
    if (input.kick  && !f._prevInput.kick)  motionPush(m, 'kick', nowMs);
  }

  // ---------- UPDATE ----------
  // ---- base (standalone) attack data: the opening hit of any combo defaults to these values, and
  // they're also the fallback if a character somehow has no COMBOS entry for a given input. Every
  // hit inside COMBOS below is fully self-contained and can freely override any of these per step.
  const ATTACKS = {
    punch: { startup: 5, active: 6, recovery: 9,  dmg: 6,  reach: 42, knock: 5, hitStun: 20, blockStun: 10, atkType: 'high' },
    kick:  { startup: 7, active: 8, recovery: 12, dmg: 10, reach: 60, knock: 7, hitStun: 22, blockStun: 12, atkType: 'high' },
  };

  // ---------- COMBAT SYSTEM 2.0: Sweep + Throw configs ----------
  // Sweep: Low Attack típus, Le+Heavy inputtal indul, a generikus attackTimer/attackCfg pipeline-t
  // használja (mint egy önálló, kombó nélküli ütés), de `knockdown:true`-val jelezve, hogy tiszta
  // találat esetén NEM a szokásos hitStun-t, hanem azonnal Knockdown-t okoz.
  const SWEEP_CFG = { startup: 10, active: 8, recovery: 20, dmg: 9, reach: 58, knock: 4, hitStun: 0, blockStun: 16, atkType: 'low', knockdown: true };
  // Throw: teljesen KÜLÖN mechanika -- saját f.throwTimer/f.throwHasHit mező, NEM megy át az
  // attackCfg/ComboManager csövön, nem blokkolható semmilyen guarddal (ld. resolveGuardOutcome).
  const THROW_CFG = { startup: 10, active: 8, recovery: 16, dmg: 13, range: 46, atkType: 'throw' };
  const BEING_THROWN_FRAMES = 41;   // rövid "repülés" fázis a dobás után, mielőtt Knockdown kezdődik (~683ms @60fps, az új BEINGTHROWN klip 8 frame-jéhez igazítva)
  const GETUP_FRAMES = 34;          // Get Up állapot hossza -- Knockdown vége és Idle között (~567ms, az új GETUP klip 8 frame-jéhez igazítva)
  const TAUNT_DURATION_MS = 1040;   // fallback for any character with no dedicated taunt clip
  // Real taunt length for charId, taken from its own CLIP_CONFIG.taunt frames when present (Barna's
  // 8-frame clip is still exactly TAUNT_DURATION_MS, Tomi's new 10-frame clip is longer) -- so the
  // clip always plays back at its own natural per-frame pace instead of being squeezed/stretched to
  // fit a single shared constant calibrated for a different character's frame count.
  function tauntTotalDuration(charId){
    const cfg = CLIP_CONFIG[charId] && CLIP_CONFIG[charId].taunt;
    if (cfg && cfg.frameMs) return cfg.frameMs.reduce((a,b)=>a+b, 0);
    return TAUNT_DURATION_MS;
  }
  const THROW_PUSH_VX = 7;          // vízszintes lökés a Being Thrown fázis alatt ("kis távolságra essen")
  // Throw Direction System: Back Throw esetén az ellenfél nem csak hátrafelé lökődik ugyanazon az
  // oldalon, hanem TÉNYLEGESEN átkerül a dobó karakter másik oldalára (valódi oldalváltás) -- ennyi
  // rés marad kettejük közt a Back Throw ívének végén (landoláskor), mielőtt Knockdow-ba kerül.
  const THROW_BACK_GAP = 6;
  // Back Throw: a pozícióváltás NEM teleport, hanem folyamatos, íves mozgás a Being Thrown fázis
  // (BEING_THROWN_FRAMES) teljes hossza alatt -- ld. f.throwArcActive/throwArcStartX/throwArcEndX és
  // a hozzá tartozó frame-ről frame-re interpoláló blokk updateFighter-ben. Ez a konstans az ív
  // csúcsmagassága a talaj fölött (a "fölötte/mellette átrepül" vizuális hatáshoz).
  const THROW_ARC_HEIGHT = 55;
  // Throw input "chord" tűrési ablak: egy valódi ember sosem nyomja le a Light+Heavy gombot pontosan
  // ugyanabban a frame-ben -- rendszerint az egyiket megnyomja, aztán néhány (10-100ms-en belüli)
  // pillanattal később a másikat, gyakran úgy, hogy az első gombot közben már el is engedte. Emiatt
  // NEM elég azt nézni, hogy a másik gomb "épp lenyomva van-e" ugyanabban a frame-ben -- ez a bug
  // okozta, hogy a Throw a gyakorlatban szinte sosem sült el. Helyette mindkét gombnyomás egy rövid
  // ideig "bufferelve" marad (ld. f.throwChordPunchTimer/f.throwChordKickTimer), és ha a MÁSIK gomb
  // ezen az ablakon belül érkezik (akár az első már el is engedve közben), az már Throw-nak számít.
  const THROW_CHORD_WINDOW_MS = 130;

  // ---------- COMBO SYSTEM ----------
  // A real combo system, not a generic "any attack cancels into any attack" chain: each character has
  // their own ordered list of NAMED combo sequences (COMBOS[charId]), and ComboManager below is the
  // single owner of input buffering, the combo time window, hit-confirm, per-hit damage/hitstun/
  // blockstun, damage scaling, and the on-screen hit counter. drawFighter/pickPose need ZERO changes --
  // they already just read f.attackType ('punch'/'kick') + f.attackTimer, which every combo hit sets
  // exactly like a standalone attack did before.
  //
  // COMBOS[charId] = ordered array of combo definitions. `input` is the exact button sequence
  // (['punch','punch','kick'] etc.); `hits` is the same length, one fully self-contained stat block
  // per step (own startup/active/recovery/dmg/reach/knock/hitStun/blockStun) -- so a combo's 2nd or
  // 3rd hit can already hit harder / knock further than the opener, independent of any other combo or
  // character. Adding a new combo, or giving a character an entirely different sequence later, is
  // purely a data change here -- ComboManager itself never needs to change.
  //
  // ---- forward-compatibility (documented now, not implemented yet -- v1 is grounded light/heavy) ----
  //   launcher / air combo / juggle: a hit entry could gain e.g. `launch:true` + its own airborne
  //     followup data; combo state already lives per-fighter independent of onGround, so an air-only
  //     branch just needs its own COMBOS entries plus an f.onGround check where combos are started.
  //   throw / command input / dash cancel / special move cancel: all just new `input` token types
  //     ('throw', 'qcf+punch', 'dash', ...) alongside 'punch'/'kick' -- the matching in ComboManager
  //     is plain string comparison and doesn't care what the tokens mean.
  //   wall bounce / ground bounce / counter hit / parry: additional per-hit flags (`wallBounce:true`,
  //     `counterBonus:{...}`) read at the exact point hitStun/knock are currently applied below.
  const COMBOS = {
    laci: [
      { name: 'Light Combo', input: ['punch','punch','kick'], hits: [
        { startup:5, active:6, recovery:9,  dmg:6,  reach:42, knock:5,  hitStun:20, blockStun:10, atkType:'high' },
        { startup:5, active:6, recovery:9,  dmg:7,  reach:44, knock:6,  hitStun:18, blockStun:10, atkType:'high' },
        { startup:7, active:8, recovery:14, dmg:12, reach:62, knock:11, hitStun:26, blockStun:14, atkType:'high' },
      ]},
      { name: 'Heavy Combo', input: ['kick','kick'], hits: [
        { startup:8, active:9,  recovery:14, dmg:11, reach:62, knock:8,  hitStun:24, blockStun:13, atkType:'high' },
        { startup:9, active:10, recovery:16, dmg:16, reach:66, knock:13, hitStun:28, blockStun:15, atkType:'high' },
      ]},
    ],
  };
  // v1: Tomi és Laci egyelőre ugyanazt a ÜÜR / RR kombót kapja, mint Krisz (lásd a kérés példáját) --
  // ez a két sor bármikor lecserélhető saját, karakterenként egyedi COMBOS bejegyzésre, a rendszer
  // maga már most is teljesen karakterenkénti (nincs semmi hardcode-olva Krisz-specifikusan).
  // Punch Combo / Kick Combo: a same-button 3-hit chain (Jab->Cross->Hook / Kick1->Kick2->Kick3),
  // each hit stronger than the last, third hit strongest -- per the "Combo rendszer atalakitas"
  // spec. Tomi and Barna share the exact same stat blocks (identical mechanic for both); Krisz
  // and Laci are explicitly OUT of scope for this rework and keep their existing Light/Heavy combo.
  const PUNCH_CHAIN_HITS = [
    { startup:4, active:5, recovery:7,  dmg:5,  reach:40, knock:1,  hitStun:16, blockStun:8,  atkType:'high' }, // Jab -- light push, keeps combo in range
    { startup:4, active:5, recovery:8,  dmg:7,  reach:44, knock:2,  hitStun:18, blockStun:9,  atkType:'high' }, // Cross -- light push, keeps combo in range
    { startup:6, active:7, recovery:12, dmg:13, reach:50, knock:12, hitStun:26, blockStun:13, atkType:'high' }, // Hook -- 3rd hit always triggers the global knockdown push (KNOCKDOWN_PUSH), sends far
  ];
  const KICK_CHAIN_HITS = [
    { startup:6, active:7, recovery:10, dmg:8,  reach:56, knock:2,  hitStun:20, blockStun:10, atkType:'high' }, // light push, keeps combo in range
    { startup:6, active:7, recovery:11, dmg:10, reach:58, knock:3,  hitStun:22, blockStun:11, atkType:'high' }, // light push, keeps combo in range
    { startup:8, active:9, recovery:15, dmg:17, reach:66, knock:15, hitStun:30, blockStun:16, atkType:'high' }, // 3rd hit always triggers the global knockdown push (KNOCKDOWN_PUSH), sends far
  ];
  COMBOS.tomi = [
    { name: 'Punch Combo', input: ['punch','punch','punch'], hits: PUNCH_CHAIN_HITS },
    { name: 'Kick Combo',  input: ['kick','kick','kick'],   hits: KICK_CHAIN_HITS },
  ];
  COMBOS.barna = [
    { name: 'Punch Combo', input: ['punch','punch','punch'], hits: PUNCH_CHAIN_HITS },
    { name: 'Kick Combo',  input: ['kick','kick','kick'],   hits: KICK_CHAIN_HITS },
  ];
  // Krisz now joins the 3-hit Punch/Kick Combo system too -- his refreshed punch/kick sheets are
  // 3 hits x 4 frames, so each press plays one clean hit (punch1/2/3, kick1/2/3 clips). Laci keeps
  // the legacy Light/Heavy combo (its own entry above), unaffected.
  COMBOS.krisz = [
    { name: 'Punch Combo', input: ['punch','punch','punch'], hits: PUNCH_CHAIN_HITS },
    { name: 'Kick Combo',  input: ['kick','kick','kick'],   hits: KICK_CHAIN_HITS },
  ];

  const COMBO_WINDOW_MS = 300;        // Combo Window: találat/blokk után ennyi ideig fogadja el a következő inputot (250-350ms)
  const INPUT_BUFFER_MS = 130;        // Input Buffer: ha a gomb kicsit korábban jön, ennyi ideig "vár" (100-150ms)
  const COMBO_COUNTER_HOLD_MS = 2200; // a "N HIT" felirat ennyi ideig marad kint a kombó megszakadása után
  const COMBO_DMG_STEP = 0.1;         // Damage Scaling: 100% / 90% / 80% / ... a kombó minden újabb tiszta találatánál
  const COMBO_DMG_FLOOR = 0.4;        // sebzés-skálázás alsó határa
  const COMBO_LIMIT = 3;              // ennyi tiszta találat után automatikus knockdown -- a kombó ezzel véget ér
  const KNOCKDOWN_FRAMES = 54;        // ~0.9s @ 60fps földön fekvés + invulnerability (az új KNOCKDOWN klip 8 frame-jéhez igazítva)
  const KNOCKDOWN_PUSH = 14;          // hátralökés erőssége knockdownnál
  const ATTACKER_SEPARATION = 10;     // knockdownnál a TÁMADÓ is hátralép, hogy sarokban se ragadjanak egymás mellett
  const PUSHBACK_STEP = 1.6;          // extra hátralökés (tiszta) találatonként egy kombón belül

  // ---- Berserk meter tuning (see makeFighter's manaMs/manaFillMs + applyDamage + BERSERK_MOVES) ----
  const BERSERK_FILL_MS = 20000;      // real-time fill 0 -> full (slow); same for every character
  const BERSERK_DMG_FILL = 0.05;      // + this fraction of the whole bar each time the fighter TAKES a hit

  function attackDuration(cfg){ return cfg.startup + cfg.active + cfg.recovery; }
  function attackBox(f){
    const reach = f.attackCfg ? f.attackCfg.reach : 42;
    const bx = f.facing === 1 ? f.x + f.w : f.x - reach;
    return { x: bx, y: f.y - 100, w: reach, h: 60 };
  }
  // fully clears a fighter's combo-tracking state (does NOT touch attackType/attackTimer -- whatever
  // hit is physically playing keeps playing out, this only affects whether/how it can CONTINUE into a
  // next one). Starts the "N HIT" counter's fade-out clock instead of hiding it immediately, per spec.
  //
  // ---------- COMBAT SYSTEM 2.0: guard type + invulnerability helpers ----------
  // f.guardType ('high'|'crouch'|null) is computed once per frame in updateFighter from raw input
  // (Block gomb +- Le). f.blocking stays a derived "is in ANY blocking posture" bool so every bit of
  // existing movement-lock / canUseUltimate / pickPose code that already reads f.blocking keeps
  // working unchanged -- this is the "legkevesebb visszafelé nem kompatibilis változtatás" approach.
  function computeGuardType(f, input){
    if (!f.onGround) return null; // nincs légi blokk (v1 -- egyszerű marad, ahogy a kérés is sugallja)
    if (input.down && input.block) return 'crouch';
    if (input.block) return 'high';
    return null;
  }
  // A blokkolási mátrix, pontosan a kérés specifikációja szerint:
  //   High Block   véd:  High Attack.           NEM véd: Sweep / Low Attack, Throw.
  //   Crouch Block véd:  Sweep / Low Attack.     NEM véd: High Attack, Throw.
  //   Throw: egyik guarddal sem védhető -- (a Throw egyébként soha nem is jut el ide, mert külön,
  //   saját hitboxú/idővonalú mechanika, sosem megy át ezen a függvényen; a throw ág itt csak a
  //   teljesség kedvéért explicit).
  function resolveGuardOutcome(defender, atkType){
    if (atkType === 'throw') return false;
    const g = defender.guardType;
    if (!g) return false;
    if (atkType === 'low') return g === 'crouch';
    return g === 'high'; // 'high' (és minden meg nem nevezett/alapértelmezett típus) csak High Blockkal védhető
  }
  // Knockdown / Get Up / Being Thrown alatt a karakter sebezhetetlen -- ez zárja ki, hogy a
  // "nem lehet végtelen kombóban tartani" előírás sérüljön (a földön fekvő/felkelő fél nem kaphat
  // újabb találatot, amíg vissza nem tér Idle-be).
  function isInvulnerable(f){
    return f.knockdownTimer > 0 || f.getUpTimer > 0 || f.beingThrownTimer > 0;
  }
  // ---------- TRAINING MODE: közös sebzés-alkalmazó ----------
  // Minden sebzés-alkalmazás EZEN megy át (kombó, blokkolt chip-sebzés, Sweep, Throw, Ultimate,
  // projectile), hogy egyetlen helyen legyen a Training Mode két speciális szabálya:
  //   1) minden 3. sebzés-esemény után a karakter élete azonnal visszaugrik a maximumra;
  //   2) az élet SOHA nem éri el pontosan a 0-t Training Mode-ban -- pickPose() a 'lose' pózt
  //      f.hp<=0 alapján a gameOver flag-től FÜGGETLENÜL is megjeleníti, úgyhogy egy tényleges
  //      0 HP itt beragadt KO-pózt eredményezne, holott a meccs Training Mode-ban sosem ér véget.
  // Minden más módban ez pontosan a régi `hp = Math.max(0, hp - dmg)` viselkedés, változatlanul.
  function applyDamage(target, dmg){
    if (dmg <= 0) return;
    // Taking a hit charges the victim's Berserk meter a little (BERSERK_DMG_FILL of the bar per hit),
    // on top of the slow real-time fill — so an aggressive opponent hands you your Berserk Move faster.
    // (Training keeps the bar pinned full anyway, so skip it there.)
    if (mode !== 'training' && target.manaMs < target.manaFillMs){
      target.manaMs = Math.min(target.manaFillMs, target.manaMs + target.manaFillMs * BERSERK_DMG_FILL);
    }
    if (mode === 'training'){
      target.trainingHitCount = (target.trainingHitCount || 0) + 1;
      if (target.trainingHitCount >= 3){
        target.trainingHitCount = 0;
        target.hp = target.maxHp;
        return;
      }
      target.hp = Math.max(1, target.hp - dmg);
    } else {
      target.hp = Math.max(0, target.hp - dmg);
    }
  }
  function resetCombo(f){
    f.combo.def = null; f.combo.step = 0;
    f.combo.windowOpen = false; f.combo.windowTimer = 0;
    f.combo.buffered = null; f.combo.bufferTimer = 0;
    f.combo.counterHoldTimer = COMBO_COUNTER_HOLD_MS;
  }
  const ComboManager = {
    // plays a single hit -- either the opener of a brand new combo or the next step of an ongoing one.
    // This fully overwrites whatever attack was previously in progress, which IS the "cancel".
    _play(f, def, stepIdx){
      f.combo.def = def; f.combo.step = stepIdx;
      f.combo.windowOpen = false; f.combo.windowTimer = 0;
      f.combo.buffered = null; f.combo.bufferTimer = 0;
      const hit = def.hits[stepIdx];
      f.attackType = def.input[stepIdx];
      // latch the per-step art pose for the WHOLE duration of this hit -- pickPose reads this
      // instead of f.combo.def, so a whiff (which resets the combo bookkeeping mid-swing via
      // onWhiff) can no longer cut the visible animation short / swap art mid-swing.
      f.attackStepPose = def.input[stepIdx] + (stepIdx + 1);
      f.attackCfg = hit;
      f.attackTimer = attackDuration(hit);
      f.hasHit = false;
    },
    // fresh press with no combo currently in progress -- starts whichever combo definition begins
    // with this input; falls back to a plain standalone attack (base ATTACKS[type] stats) if this
    // character has no combo starting with it.
    startFresh(f, inputName){
      const defs = COMBOS[f.charId] || [];
      const def = defs.find(d => d.input[0] === inputName);
      if (def){
        f.combo.hitCount = 0; // egy vadonatúj kombó indul -- a régi számláló nullázódik
        this._play(f, def, 0);
      } else {
        f.combo.def = null; f.combo.step = 0;
        f.attackType = inputName;
        f.attackStepPose = null; // plain non-combo attack -> legacy 'punch'/'kick' pose
        f.attackCfg = ATTACKS[inputName];
        f.attackTimer = attackDuration(ATTACKS[inputName]);
        f.hasHit = false;
      }
    },
    // a fresh (edge-triggered) button press while `f` is mid-combo (attacking, or inside the
    // post-hit-confirm window). Continues the sequence ONLY if this input is exactly the correct
    // next step AND the Combo Window is open (Hit Confirm already succeeded). This function must
    // NEVER fall through to starting a brand new combo on its own -- that was the infinite-combo
    // bug: any mistimed/extra press would instantly cancel the current attack (skipping its
    // recovery entirely) and restart from hit 1, which both let players mash forever with no
    // recovery pause AND meant most restarted hits never survived long enough to reach their own
    // active frames, so damage barely registered and the combo counter could never hold still.
    // A fresh combo may only begin again via startFresh(), which the caller (updateFighter) only
    // reaches once f.attackTimer <= 0 AND f.combo.def is null -- i.e. the current move (including
    // its recovery) has fully played out AND the post-hit Combo Window has closed. That gap is
    // exactly the "kis idő amíg leáll a karakter" the 3-hit (or 2-hit Heavy) cap needs.
    tryAdvance(f, inputName){
      const def = f.combo.def;
      if (!def){
        // nincs aktív kombó-nyilvántartás, de f.attackTimer még fut (önálló, kombó nélküli
        // mozdulat van folyamatban) -- bufferelünk, hogy a mozdulat végén azonnal felhasználható
        // legyen az input egy új próbálkozáshoz, ahelyett hogy azonnal félbeszakítaná
        f.combo.buffered = inputName;
        f.combo.bufferTimer = INPUT_BUFFER_MS;
        return;
      }
      const hasNextStep = (f.combo.step + 1) < def.hits.length;
      if (f.combo.windowOpen){
        if (hasNextStep && def.input[f.combo.step+1] === inputName){
          this._play(f, def, f.combo.step+1);
        }
        // rossz gomb jött, VAGY a kombónak már nincs több lépése (a 3. -- ill. Heavy Combónál a
        // 2. -- találat volt az utolsó): a gombnyomás szándékosan elvész itt. A karakter kénytelen
        // kivárni, amíg a Combo Window lejár és a kombó nullázódik (ld. ComboManager.update) --
        // ez zárja ki a végtelen kombót és adja meg a kért kis szünetet.
        return;
      }
      // Hit Confirm még nem dőlt el (startup/active közben vagyunk) -- Input Buffer: megjegyezzük,
      // és a window megnyílásakor azonnal felhasználjuk, ha még nem járt le
      f.combo.buffered = inputName;
      f.combo.bufferTimer = INPUT_BUFFER_MS;
    },
    // hívva a találat-detektálás pillanatában (lásd updateFighter) -- ITT dől el a Hit Confirm: a
    // kombó csak akkor mehet tovább, ha ez az ütés ténylegesen becsapódott vagy blokkolva lett.
    onHitConfirmed(f){
      if (!f.combo.def) return;
      f.combo.windowOpen = true;
      f.combo.windowTimer = COMBO_WINDOW_MS;
      if (f.combo.buffered && f.combo.bufferTimer > 0){
        const next = f.combo.buffered;
        f.combo.buffered = null; f.combo.bufferTimer = 0;
        this.tryAdvance(f, next);
      }
    },
    // az active ablak lezárult és NEM volt találat (teljes mellélövés) -- Hit Confirm sikertelen, a
    // kombó véget ér, a bufferolt input is elvész (nem lehet "ingyen" végigvinni egy kombót anélkül,
    // hogy bármi is találna vagy blokkolva lenne).
    onWhiff(f){ resetCombo(f); },
    // frame-ről frame-re hívva minden fighterre: input buffer lejárat, combo window lejárat, és a
    // "N HIT" felirat automatikus eltűnése -- mind valós idő (dt, ms), nem frame-számláló alapú.
    update(f, dt){
      if (f.combo.bufferTimer > 0){
        f.combo.bufferTimer -= dt;
        if (f.combo.bufferTimer <= 0){ f.combo.bufferTimer = 0; f.combo.buffered = null; }
      }
      if (f.combo.windowOpen){
        f.combo.windowTimer -= dt;
        if (f.combo.windowTimer <= 0) resetCombo(f); // senki nem folytatta időben -- a kombó lezárul, Idle-be tér vissza
      }
      if (f.combo.counterHoldTimer > 0){
        f.combo.counterHoldTimer -= dt;
        if (f.combo.counterHoldTimer <= 0){ f.combo.counterHoldTimer = 0; f.combo.hitCount = 0; }
      }
    },
  };

  // ---------- COMBAT SYSTEM 2.0: Sweep + Throw dispatch ----------
  // Sweep: NEM a ComboManage-en megy át (nem kombó lépés) -- egy önálló Low Attack, amely a már
  // meglévő generikus attackTimer/attackCfg hit-detection csövet használja újra (mint egy sima,
  // kombó nélküli ütés), csak épp SWEEP_CFG stat-blokkal és 'sweep' attackType-tal.
  function startSweep(f){
    resetCombo(f); // a Sweep nem indít/folytat semmilyen ComboManager-kombót
    f.attackType = 'sweep';
    f.attackStepPose = null;
    f.attackCfg = SWEEP_CFG;
    f.attackTimer = attackDuration(SWEEP_CFG);
    f.hasHit = false;
  }
  // Throw: teljesen KÜLÖN állapot -- saját idővonal (f.throwTimer), soha nem érinti f.attackCfg/
  // f.attackType-ot, ezért a ComboManager és a generikus hit-detection blokk semmit nem tud róla.
  // A tényleges találat-ellenőrzés (hatótáv + sebezhetetlenség) az updateFighter-ben, a throw saját
  // active ablakában történik -- pont úgy, mint egy sima ütésnél, csak külön blokkban.
  function canThrow(f){
    // szándékosan NEM követeli meg, hogy f.attackTimer <= 0 legyen -- a Throw, pont úgy mint a
    // ComboManager._play(), szabadon "cancel"-eli a folyamatban lévő ütést (ld. startThrow), hogy a
    // Light+Heavy egyszerre input (ahol a két gomb 1-2 frame csúszással érkezik) valóban felülírja az
    // első gombra elindult sima ütést, ne ragadjon be annak startup/recovery idejére.
    return f.throwTimer <= 0 && !isInvulnerable(f) &&
      f.staggerTimer <= 0 && f.blockStunTimer <= 0 && f.beingThrownTimer <= 0;
  }
  // Throw Direction System: az irányt (Forward/Back) KIZÁRÓLAG a dobás INDÍTÁSÁNAK pillanatában
  // olvassuk le (a hívó fél adja át `isBack`-ként), és eltároljuk f.throwIsBack-ben egészen a Throw
  // végéig -- a később lenyomott/elengedett iránygomb már nem módosíthatja, pontosan a kérés szerint.
  function startThrow(f, isBack){
    resetCombo(f);
    f.attackTimer = 0; // a Throw felülírja/megszakítja a folyamatban lévő ütést -- ez a "cancel"
    f.throwTimer = attackDuration(THROW_CFG);
    f.throwHasHit = false;
    f.throwIsBack = !!isBack;
  }

  // ---------- ULTIMATE MANAGER ----------
  // Generic, data-driven "once per match" super move system. Nothing here is Krisz-specific — a new
  // character gets an ultimate by adding one more entry to ULTIMATES (+ its own SPRITE_DATA_ULTIMATES
  // block above), no other code in this file needs to change.
  //
  // Each entry:
  //   poses:         ordered list of sprite-pose keys to play back-to-back (must match SPRITE_DATA_ULTIMATES)
  //   poseDurations: how many REAL MILLISECONDS each of those poses stays on screen, same length/order
  //                  as `poses`. This is time-based (delta-time driven, see updateFighter/loop), not a
  //                  frame count, so playback speed is identical regardless of the player's monitor
  //                  refresh rate or any hitches/dropped frames.
  //   hitPoseIndex + activeOffsetMs/activeLenMs: which pose, and which millisecond-window inside it, is
  //               the single hitbox live window (usually the impact frame)
  //   anchors:    per-pose pivot point, in that frame's OWN source-pixel coordinates — {x: horizontal
  //               body-center, y: ground/foot contact line}. The raw cut-out frames are tight crops and
  //               each one's bounding box is a different shape (props like the STOP sign/cone stick out
  //               by different amounts), so without a calibrated anchor per frame the character visibly
  //               jumps/vibrates every time the pose switches. Poses with no entry here fall back to the
  //               default center/bottom pivot used by the normal (non-ultimate) sprite sheets.
  //   ultScale:   fixed size multiplier used ONLY for this character's ultimate-pose sprites, instead
  //               of the normal targetH/idleNaturalHeight formula. The ultimate sheet is a separate
  //               generated image from the main sprite sheet, so it isn't guaranteed to draw the
  //               character at the same pixels-per-character-height as the main sheet — reusing the
  //               idle-based ratio made Tomi render visibly larger (and Krisz very slightly smaller)
  //               than his normal size during the animation. This value is calibrated once (by
  //               comparing the character's own body height, in px, between their idle sprite and
  //               their ultimate sheet's neutral standing frame) so the body renders at the exact same
  //               on-screen size as normal gameplay, no matter how the ultimate sheet itself was drawn.
  //   dmgPct:     fraction of the VICTIM's maxHp dealt on a clean hit
  //   knockVx/knockVy/stun: knockback + hitstun applied on a clean hit
  //   reach/hitboxH: hitbox size, same idea as ATTACKS[type].reach
  //   hitStopFrames/shakeAmt: impact juice tuning
  //   kind: 'melee' (default, omit it) uses the hitPoseIndex/reach/hitboxH/dmgPct/etc. fields above
  //         directly, like Krisz's STOP-sign swing. kind: 'projectile' instead fires off a Projectile
  //         (see PROJECTILE MANAGER below) at `spawnPoseIndex`/`spawnOffset` using `projectileType`'s
  //         own damage/knockback/effect numbers — the fighter's own dmgPct/knock*/reach/hitboxH/
  //         hitPoseIndex/activeOffsetMs/activeLenMs fields are simply unused/omitted in that case.
  const ULTIMATES = {
    krisz: {
      poses: ["ult1","ult2","ult3","ult4","ult5","ult6","ult7","ult8","ult9","ult10"],
      // Refreshed sheet: stance -> reach/bend -> picks up the cone -> wears it as a hat -> pulls out the
      // STOP sign -> raises it -> swings it forward (impact = ult10). Anchors: x locked to the neutral
      // stance so the body stays planted while the sign swings out; y per-frame so the feet always land
      // on the ground (the character sits higher in the later cells to make room for the cone/sign).
      poseDurations: [170, 150, 160, 200, 150, 180, 160, 150, 140, 250],
      hitPoseIndex: 9, activeOffsetMs: 0, activeLenMs: 130,
      ultScale: 0.4352,
      anchors: [
        {x:144.3,y:495.0}, {x:144.3,y:495.0}, {x:144.3,y:495.0}, {x:144.3,y:497.0}, {x:144.3,y:495.0},
        {x:144.3,y:438.0}, {x:144.3,y:451.0}, {x:144.3,y:435.0}, {x:144.3,y:444.0}, {x:144.3,y:443.0},
      ],
      dmgPct: 0.33, knockVx: 18, knockVy: -6, stun: 60,
      reach: 130, hitboxH: 110,
      hitStopFrames: 6, shakeAmt: 26,
    },
    tomi: {
      poses: ['ult1','ult2','ult3','ult4','ult5','ult6','ult7','ult8','ult9','ult10'],
      // uveget felkapja -> magasba emeli -> lenduletes mozdulattal KOZELHARCBAN szetzuzza az ellenfelen
      // (ult6-nal, ahol a sprite mar a szilankok szetrepuleset mutatja) -> a megmaradt csorba nyakkal
      // buszke poz. NEM tavolsagi dobas -- kozelre kell allni az ellenfelhez, hogy eltalalja (lasd
      // hitPoseIndex/reach/hitboxH lent), a regi projectile-mechanika (spawnPoseIndex/projectileType)
      // ide most mar nem illik, mert az uj sheeten Tomi tenylegesen ra csapja az uveget az ellenfelre.
      poseDurations: [180,180,160,150,110,140,120,150,200,220],
      hitPoseIndex: 5, activeOffsetMs: 0, activeLenMs: 140, // ult6 (index 5) = a becsapodas kockaja
      dmgPct: 0.33, knockVx: 18, knockVy: -6, stun: 60,
      reach: 110, hitboxH: 120,
      hitStopFrames: 6, shakeAmt: 26,
      ultScale: 0.6539,
      anchors: [{x:113.4, y:343.0}, {x:51.2, y:327.0}, {x:118.1, y:338.0}, {x:93.2, y:389.0}, {x:135.0, y:274.0}, {x:110.3, y:312.0}, {x:86.7, y:318.0}, {x:86.0, y:333.0}, {x:82.4, y:333.0}, {x:55.9, y:320.0}],
    },

    laci: {
      kind: 'projectile',
      poses: ["ult1","ult2","ult3","ult4","ult5","ult6","ult7","ult8","ult9"],
      // felveszi a hangfalat + célra tart (ult2-ult6) egy kicsit lassabban, a dobás (ult7) gyors és pörgős,
      // utána a büszke pörgés + "Grand Finale" pillanat (ult8-ult9) hosszabban kitart.
      poseDurations: [150, 220, 180, 180, 200, 220, 110, 130, 500],
      spawnPoseIndex: 6,               // ult7 (index 6) = a dobás pillanata — a hangfal itt hagyja el a kezét
      spawnOffset: { x: 15, y: -95 },  // kb. kéz magasságban, Laci előtt, a nézési iránya felé
      projectileType: 'laci_speaker',
      ultScale: 0.638,
      anchors: [
        {x:78, y:280}, {x:70, y:291}, {x:80, y:296}, {x:76, y:291}, {x:65, y:250},
        {x:95, y:362}, {x:110,y:228}, {x:115,y:247}, {x:95, y:292},
      ],
      finalePoseIndex: 8,              // ult9 (utolsó póz) — a büszke pózolás pillanata
      finaleText: 'LACI — GRAND FINALE! 🎆',
    },
    barna: {
      kind: 'projectile',
      poses: ["ult1","ult2","ult3","ult4","ult5","ult6","ult7","ult8","ult9","ult10"],
      // uj sprite sheet, ugyanaz a koncepcio: felveszi/labdazik -> lenduletet vesz -> kirugja a
      // labdat (ult8, itt hagyja el a labat) -> buszke poz -> a labda mar tavolodik (ult10).
      poseDurations: [150, 150, 140, 140, 140, 160, 100, 90, 200, 300],
      spawnPoseIndex: 7,
      spawnOffset: { x: 20, y: -30 },
      projectileType: 'barna_ball',
      ultScale: 0.5185,
      anchors: [
        {x:92.7, y:351.0}, {x:69.6, y:342.0}, {x:90.9, y:344.0}, {x:94.6, y:351.0}, {x:78.2, y:344.0},
        {x:92.4, y:322.0}, {x:119.9,y:334.0}, {x:134.8,y:331.0}, {x:77.0, y:350.0}, {x:79.8, y:347.0},
      ],
    },
  };
  // ---------- Ultimate animation: wire into the GENERIC CLIP SYSTEM ----------
  // The Ultimate sequence used to be N distinct static poses ("ult1".."ultN") cross-faded into each
  // other by the legacy pose-blend system (see animCommitPose's old ucfg special-case + ultSpriteSet
  // in drawFighter). That still worked, but it's the one place left using the old technique instead of
  // the newer clip-controller (CLIP_CONFIG/SPRITE_DATA_CLIPS) that already drives every other Barna
  // move: real cuts between frames, no cross-fade, hold-on-last-frame semantics, etc.
  // This block reuses the EXISTING per-pose art (already-decoded Image objects in sprites.ultimates,
  // see the SPRITE_DATA_ULTIMATES loader above) as the frames of one new 'ultimate' clip per
  // character -- no new art is generated. poseDurations/anchors/ultScale are reused as-is, so the
  // clip plays back at exactly the same speed and pivots as before. Gameplay logic (hit window,
  // projectile spawn, finale banner) is untouched: it reads ultimatePoseInfo()/poseIndex directly,
  // never the rendered pose name, so none of that timing code needed to change.
  // Called by ensureFighterLoaded once a character's ultimate frames have been constructed.
  // Idempotent: only wires the 'ultimate' clip once, and only when every frame Image exists.
  function wireUltimateClip(charId){
    const ucfg = ULTIMATES[charId];
    if (!ucfg) return;
    if (CLIP_CONFIG[charId] && CLIP_CONFIG[charId].ultimate) return; // already wired
    const imgs = ucfg.poses.map(p => sprites.ultimates[charId] && sprites.ultimates[charId][p]).filter(Boolean);
    if (imgs.length !== ucfg.poses.length) return; // safety net: only wire up if every frame is present
    if (!CLIP_CONFIG[charId]) CLIP_CONFIG[charId] = {};
    CLIP_CONFIG[charId].ultimate = {
      loop: false,
      frameMs: ucfg.poseDurations.slice(),
      anchors: ucfg.anchors ? ucfg.anchors.slice() : undefined,
      scale: ucfg.ultScale,
    };
    if (!sprites.clips[charId]) sprites.clips[charId] = {};
    sprites.clips[charId].ultimate = imgs;
  }
  function ultimateTotalDuration(charId){
    const cfg = ULTIMATES[charId];
    if (!cfg) return 0;
    return cfg.poseDurations.reduce((a,b)=>a+b, 0);
  }
  // maps "elapsed real milliseconds since the ultimate started" to which pose should be showing right now
  function ultimatePoseInfo(charId, elapsedMs){
    const cfg = ULTIMATES[charId];
    if (!cfg) return null;
    let acc = 0;
    for (let i=0;i<cfg.poseDurations.length;i++){
      if (elapsedMs < acc + cfg.poseDurations[i]){
        return { poseName: cfg.poses[i], poseIndex: i, msIntoPose: elapsedMs - acc };
      }
      acc += cfg.poseDurations[i];
    }
    const last = cfg.poseDurations.length - 1;
    return { poseName: cfg.poses[last], poseIndex: last, msIntoPose: cfg.poseDurations[last] };
  }
  // per-pose pivot lookup used by drawFighter — returns null for poses with no calibrated anchor
  // (i.e. all the normal, non-ultimate poses), which just keeps the old center/bottom pivot behavior.
  // ---------- ENTER (SPAWN) ANIMATION MANAGER ----------
  // Generic, data-driven per-character "walk-in" animation played once at the start of every round, for
  // the whole 5-second pre-fight countdown (see CountdownManager further below). Same architecture as
  // ULTIMATES above -- a new character gets an Enter Animation just by adding one more entry here (+ its
  // own SPRITE_DATA_ENTER block above), nothing else in this file needs to change.
  //
  // Each entry:
  //   poses:         ordered list of sprite-pose keys to play back-to-back (must match SPRITE_DATA_ENTER)
  //   poseDurations: how many REAL MILLISECONDS each pose stays on screen, same length/order as `poses`,
  //                  delta-time driven exactly like ULTIMATES.poseDurations -- identical speed regardless
  //                  of frame rate. The poses are deliberately budgeted to finish well BEFORE the 5000ms
  //                  countdown ends (see EnterAnimationManager.getPoseFor below): once every pose has
  //                  played, the fighter automatically settles into their normal 'idle' pose for the
  //                  remaining countdown beats, so nobody is left frozen mid-gesture when "FIGHT!" appears.
  //   anchors:       per-pose pivot point in that frame's OWN source-pixel coordinates -- {x: horizontal
  //                  body-center, y: ground/foot contact line} -- same idea/reason as ULTIMATES.anchors
  //                  (these are independently-generated reference sheets; each pose is a differently
  //                  shaped tight crop, so an uncalibrated center/bottom pivot makes the character hop
  //                  sideways every time the pose switches).
  //   scale:         fixed size multiplier for this character's Enter-animation sprites, calibrated once
  //                  the same way as ULTIMATES.ultScale (comparing body height in px between the idle
  //                  sprite and this sheet's own neutral standing frame) so the character renders at the
  //                  exact same on-screen size as normal gameplay.
  //
  // ---- forward-compatibility hooks (all optional, unused today, safe to ignore until needed) ----
  //   Nothing below wires up real sounds/particles/camera work yet -- these are no-op stubs so that
  //   adding a sound cue, a puff of dust, or a camera nudge later is a one-line change inside the stub,
  //   not a new code path threaded through the manager.
  const ENTER_ANIMATIONS = {
    krisz: {
      // Refreshed 10-frame entrance: strolls in with sunglasses -> pushes them up -> takes them off ->
      // flings them away -> roars/flexes up -> settles into the fighting stance. Per-frame anchors
      // (centroid x + content-bottom y) keep him planted as he walks in and pumps up.
      poses: ["enter1","enter2","enter3","enter4","enter5","enter6","enter7","enter8","enter9","enter10"],
      poseDurations: [280, 240, 240, 240, 220, 280, 300, 260, 240, 240],
      scale: 0.4341,
      anchors: [
        {x:109.3,y:428.0}, {x:91.3,y:433.0}, {x:82.2,y:434.0}, {x:74.7,y:429.0}, {x:65.8,y:433.0},
        {x:126.4,y:378.0}, {x:125.9,y:379.0}, {x:112.8,y:379.0}, {x:100.6,y:381.0}, {x:91.3,y:381.0},
      ],
    },
    tomi: {
      // uj, 10-pozos bevonulas (2. verzio): lezseren besetal (borkabatban) -> elkezdi lehuzni a
      // vallarol -> lelendíti -> földre dobja a kabatot -> leporolja magat -> harci pozba all
      poses: ['enter1','enter2','enter3','enter4','enter5','enter6','enter7','enter8','enter9','enter10'],
      poseDurations: [400,380,350,340,330,320,320,310,320,340],
      scale: 0.5367,
      anchors: [{x:56.7, y:390.0}, {x:86.5, y:378.0}, {x:94.0, y:376.0}, {x:96.9, y:374.0}, {x:85.9, y:373.0}, {x:81.1, y:370.0}, {x:112.2, y:367.0}, {x:81.2, y:361.0}, {x:124.1, y:375.0}, {x:90.1, y:379.0}],
    },

    laci: {
      // besetal napszemüvegben -> leveszi -> kigombolja es leveszi az ingét -> eldobja az inget
      poses: ["enter1","enter2","enter3","enter4"],
      poseDurations: [400, 380, 480, 320],
      scale: 0.574,
      anchors: [
        {x:79, y:317}, {x:80, y:318}, {x:122, y:311}, {x:84, y:315},
      ],
    },
    barna: {
      // uj, 10-pozos bevonulas: fejere teszi a KFC vodrot -> issza/eszi belole -> buszken magasba
      // emeli -> eldobja -> harci pozba all (a regi 4-pozos verziohoz kepest reszletesebb mozgassorral)
      poses: ["enter1","enter2","enter3","enter4","enter5","enter6","enter7","enter8","enter9","enter10"],
      poseDurations: [360, 360, 380, 360, 350, 350, 350, 340, 340, 340],
      scale: 0.56,
      anchors: [
        {x:92.9, y:325.0}, {x:85.7, y:326.0}, {x:86.6, y:369.0}, {x:128.6,y:313.0}, {x:72.0, y:315.0},
        {x:81.5, y:314.0}, {x:71.5, y:317.0}, {x:71.6, y:317.0}, {x:71.6, y:326.0}, {x:75.6, y:325.0},
      ],
    },
  };
  function enterAnimTotalDuration(charId){
    const cfg = ENTER_ANIMATIONS[charId];
    if (!cfg) return 0;
    return cfg.poseDurations.reduce((a,b)=>a+b, 0);
  }
  // reserved no-op hooks -- see the "forward-compatibility hooks" doc comment above.
  function playEnterSound(charId, poseIndex){ /* reserved for future per-pose sound cues */ }
  function spawnEnterParticles(f, poseIndex){ /* reserved for future per-pose particle bursts (dust/sparkle) */ }
  // Generic, character-agnostic playback state -- each fighter carries its OWN Enter-animation clock
  // (see makeFighter's enterAnim* fields below), not one shared/global timer, so two different characters
  // with different pose counts/durations always play back correctly even though both start at once.
  const EnterAnimationManager = {
    startFor(f){
      const cfg = ENTER_ANIMATIONS[f.charId];
      f.enterAnimActive = !!cfg;
      f.enterAnimElapsed = 0;
      f.enterAnimLastPoseIdx = -1;
    },
    startAll(){ if (typeof p1 !== 'undefined' && p1) this.startFor(p1); if (typeof p2 !== 'undefined' && p2) this.startFor(p2); },
    // advances this fighter's own Enter-animation clock -- called every frame while the pre-fight
    // countdown owns the loop (see loop()/CountdownManager below), delta-time driven like Ultimate.
    update(f, dt){
      if (!f || !f.enterAnimActive) return;
      const cfg = ENTER_ANIMATIONS[f.charId];
      if (!cfg){ f.enterAnimActive = false; return; }
      f.enterAnimElapsed += dt;
      const info = this._poseInfoAt(cfg, f.enterAnimElapsed);
      if (info && info.poseIndex !== f.enterAnimLastPoseIdx){
        f.enterAnimLastPoseIdx = info.poseIndex;
        playEnterSound(f.charId, info.poseIndex);
        spawnEnterParticles(f, info.poseIndex);
      }
      if (f.enterAnimElapsed >= enterAnimTotalDuration(f.charId)) f.enterAnimActive = false;
    },
    _poseInfoAt(cfg, elapsedMs){
      let acc = 0;
      for (let i=0;i<cfg.poseDurations.length;i++){
        if (elapsedMs < acc + cfg.poseDurations[i]) return { poseName: cfg.poses[i], poseIndex: i };
        acc += cfg.poseDurations[i];
      }
      return null; // past the end of every pose -- caller falls back to the normal idle pose
    },
    // what pose should drawFighter/pickPose show right now for this fighter? Returns null once the
    // animation has finished (or if this character has none defined), meaning "show the normal idle pose".
    getPoseFor(f){
      const cfg = ENTER_ANIMATIONS[f.charId];
      if (!cfg || !f.enterAnimActive) return null;
      const info = this._poseInfoAt(cfg, f.enterAnimElapsed);
      return info ? info.poseName : null;
    },
  };
  // ---------- COMBAT SYSTEM 2.0: Sweep/Throw/Being Thrown/Knockdown/Get Up/Crouch pose sprites ----------
  // Each entry: scale -- single calibrated multiplier for this character's whole Combat2 sheet (measured
  // off the Throw pose, the most standing/idle-like of the six, same calibration method as ultScale/
  // ENTER_ANIMATIONS.scale above); anchors -- per-pose {x,y} pivot in that pose's OWN tightly-cropped
  // source-pixel coordinates (x = foot-contact horizontal center for grounded poses, or the whole
  // silhouette's horizontal center of mass for the horizontal/airborne/transitional poses -- Knockdown,
  // Being Thrown, Get Up -- which have no single clean foot-contact point; y = the crop's bottom edge,
  // i.e. the ground line, same convention as every other calibrated pose set in this file).
  const COMBAT2_POSES = {
    krisz: {
      scale: 0.4232,
      anchors: {
        sweep: {x:242.9, y:351.0},
        throw: {x:170.6, y:397.0},
        beingThrown: {x:233.4, y:287.0},
        knockdown: {x:288.1, y:144.0},
        getUp: {x:226.6, y:319.0},
        crouch: {x:137.8, y:313.0},
      },
    },
    tomi: {
      scale: 0.4561,
      anchors: {
        sweep: {x:230.9, y:346.0},
        throw: {x:193.8, y:399.0},
        beingThrown: {x:223.1, y:271.0},
        knockdown: {x:284.1, y:150.0},
        getUp: {x:221.4, y:335.0},
        crouch: {x:151.3, y:329.0},
      },
    },
    laci: {
      scale: 0.4573,
      anchors: {
        sweep: {x:198.5, y:321.0},
        throw: {x:178.0, y:398.0},
        beingThrown: {x:207.7, y:274.0},
        knockdown: {x:280.3, y:145.0},
        getUp: {x:212.9, y:308.0},
        crouch: {x:139.2, y:309.0},
      },
    },
  };
  // Berserk alt-art anchors/scale for the Combat 2.0 poses -- OPTIONAL per character, same idea as
  // SPRITE_DATA_COMBAT2_SPECIAL above. Only characters with their own berserk Combat2 sheet get an
  // entry; getPoseAnchor()/drawFighter's poseScale() fall back to the normal COMBAT2_POSES entry
  // (and ultimately to normalScale) when a character has none, so this never affects Krisz/Tomi/Laci
  // until they get their own berserk Sweep/Throw/etc. art.
  const COMBAT2_POSES_SPECIAL = {
    barna: {
      scale: 0.7368,
      anchors: {
        sweep: {x:114.7, y:200.0},
        throw: {x:95.3, y:247.0},
        beingThrown: {x:102.9, y:213.0},
        knockdown: {x:121.4, y:125.0},
        getUp: {x:115.7, y:216.0},
        crouch: {x:62.0, y:214.0},
      },
    },
  };
  // per-pose pivot lookup used by drawFighter -- checks Ultimate poses first, then Enter-animation poses,
  // then the Berserk Combat2 anchors (only while `special` is true and the character has that art),
  // then the normal Combat2 poses, then falls back to null (the default center/bottom pivot) for every
  // normal (non-special) pose.
  function getPoseAnchor(charId, poseName, special, clipFrameIdx){
    const ucfg = ULTIMATES[charId];
    if (ucfg && ucfg.anchors){
      const uidx = ucfg.poses.indexOf(poseName);
      if (uidx !== -1) return ucfg.anchors[uidx];
    }
    const ecfg = ENTER_ANIMATIONS[charId];
    if (ecfg && ecfg.anchors){
      const eidx = ecfg.poses.indexOf(poseName);
      if (eidx !== -1) return ecfg.anchors[eidx];
    }
    if (special){
      const c2s = COMBAT2_POSES_SPECIAL[charId];
      if (c2s && c2s.anchors && c2s.anchors[poseName]) return c2s.anchors[poseName];
    }
    // Generic clip system (see SPRITE_DATA_CLIPS/CLIP_CONFIG above): each frame of a clip has its OWN
    // calibrated anchor, so the caller must tell us which frame is actually on screen right now.
    const clipCfg = CLIP_CONFIG[charId] && CLIP_CONFIG[charId][poseName];
    if (clipCfg && clipCfg.anchors && clipFrameIdx != null && clipCfg.anchors[clipFrameIdx]) return clipCfg.anchors[clipFrameIdx];
    const c2cfg = COMBAT2_POSES[charId];
    if (c2cfg && c2cfg.anchors && c2cfg.anchors[poseName]) return c2cfg.anchors[poseName];
    return null;
  }
  // can this fighter start their ultimate right now? (grounded, not mid-action, not already used)
  function canUseUltimate(f){
    const cfg = ULTIMATES[f.charId];
    // Training Mode: az Ultimate akárhányszor újra bevethető -- a normál "csak egyszer meccsenként"
    // szabályt (f.ultimateUsed) itt figyelmen kívül hagyjuk.
    const usableAgain = (mode === 'training') || !f.ultimateUsed;
    return !!cfg && usableAgain && f.ultimateActive <= 0 && f.onGround && f.hp > 0 &&
      f.attackTimer <= 0 && !f.combo.def && !f.blocking && f.staggerTimer <= 0 &&
      f.throwTimer <= 0 && !isInvulnerable(f) && f.berserkActive <= 0;
  }
  function startUltimate(f){
    f.ultimateUsed = true;   // consumed the moment it's triggered — no take-backs, even if punished
    f.ultimateActive = ultimateTotalDuration(f.charId); // ms remaining, not frames
    f.ultimateElapsed = 0;   // ms elapsed
    f.ultimateHasHit = false;
    f.ultimateFinaleShown = false;
    f.vx = 0;
    playUltSound('charge');
  }
  function ultimateBox(f){
    const cfg = ULTIMATES[f.charId];
    const reach = cfg ? cfg.reach : 100;
    const bx = f.facing === 1 ? f.x + f.w : f.x - reach;
    return { x: bx, y: f.y - 110, w: reach, h: cfg ? cfg.hitboxH : 90 };
  }
  // tiny placeholder WebAudio "sound effect" so the ultimate doesn't feel silent — no external
  // audio assets needed, easy to swap out for real sound files later.
  let _audioCtx = null;
  function playUltSound(kind){
    try{
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === 'suspended') _audioCtx.resume();
      const ctx2 = _audioCtx;
      const now = ctx2.currentTime;
      if (kind === 'charge'){
        const osc = ctx2.createOscillator(), gain = ctx2.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(520, now+0.35);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now+0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now+0.38);
        osc.connect(gain); gain.connect(ctx2.destination);
        osc.start(now); osc.stop(now+0.4);
      } else if (kind === 'impact'){
        const osc = ctx2.createOscillator(), gain = ctx2.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(40, now+0.25);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now+0.3);
        osc.connect(gain); gain.connect(ctx2.destination);
        osc.start(now); osc.stop(now+0.3);
        const noiseBuf = ctx2.createBuffer(1, ctx2.sampleRate*0.15, ctx2.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i=0;i<data.length;i++) data[i] = (Math.random()*2-1) * (1 - i/data.length);
        const noise = ctx2.createBufferSource(); noise.buffer = noiseBuf;
        const ngain = ctx2.createGain(); ngain.gain.setValueAtTime(0.25, now);
        noise.connect(ngain); ngain.connect(ctx2.destination);
        noise.start(now);
      }
    }catch(e){ /* audio not available — silently skip, purely cosmetic */ }
  }
  function rectsOverlap(a,b){
    return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
  }
  // kind: 'spark' (default) = the short yellow hit-lines already used for melee hits; 'shard' = small
  // rotating glass-like fragments; 'dust' = soft slow-drifting puffs. All three share one particle
  // array/update loop (see drawSparks below) — only their look + motion differ.
  function spawnSparks(x,y,n,kind){
    kind = kind || 'spark';
    for (let i=0;i<n;i++){
      const speed = kind==='dust' ? 0.6+Math.random()*1.2 : (kind==='shard' ? 3+Math.random()*4.5 : (kind==='firework' ? 2.5+Math.random()*4.5 : 2+Math.random()*3));
      const life = kind==='dust' ? 34+Math.random()*12 : (kind==='shard' ? 22+Math.random()*10 : (kind==='firework' ? 40+Math.random()*20 : 16));
      const hue = kind==='firework' ? Math.floor(Math.random()*360) : 0;
      hitSparks.push({ x, y, angle: Math.random()*Math.PI*2, dist: 0, speed, life, maxLife: life, kind, rot: Math.random()*Math.PI*2, hue });
    }
  }
  function spawnGlassShards(x,y,n){ spawnSparks(x,y,n,'shard'); }
  function spawnDust(x,y,n){ spawnSparks(x,y,n,'dust'); }
  // colorful firework burst — used by the generic Ultimate "finale" trigger (see ULTIMATES.finalePoseIndex)
  function spawnFireworks(x,y,n){ spawnSparks(x,y,n||30,'firework'); }

  // ---------- PROJECTILE MANAGER ----------
  // Generic, character-agnostic ranged-attack system — nothing here is Tomi- or bottle-specific. A
  // Projectile is a small self-contained flying object (position/velocity/spin/hitbox/lifetime) that
  // this manager spawns, moves, collision-checks and draws every frame. A future character's ranged
  // Ultimate (or even a normal special move) reuses this the same way Tomi does: add one more entry to
  // PROJECTILE_TYPES (+ its own sprite), then call spawnProjectile(owner, thatKey, x, y) — no changes
  // needed here or anywhere else in the engine.
  //
  // Each PROJECTILE_TYPES entry:
  //   spriteCharId/spriteKey: where to find its sprite image in sprites.ultimates[charId][key]
  //   speedPxPerSec/spinDegPerSec: real-time-driven flight speed + spin (delta-time based, like the
  //               Ultimate pose animation above — identical behavior regardless of frame rate)
  //   w/h:        collision hitbox size
  //   maxRange:   how far (px) it can fly before auto-expiring (shattering) if it hits nobody
  //   drawH:      on-screen height in px
  //   dmgPct/knockVx/knockVy/stun: same meaning as a melee Ultimate's fields, applied on a clean hit
  //   hitStopFrames/shakeAmt: impact juice tuning, same idea as the melee Ultimate fields
  const PROJECTILE_TYPES = {
    tomi_bottle: {
      spriteCharId: 'tomi', spriteKey: 'ult_bottle',
      speedPxPerSec: 900, spinDegPerSec: 640,
      w: 42, h: 64, maxRange: 820, drawH: 46,
      dmgPct: 0.33, knockVx: 16, knockVy: -5, stun: 55,
      hitStopFrames: 6, shakeAmt: 22,
    },
    laci_speaker: {
      spriteCharId: 'laci', spriteKey: 'ult_speaker',
      speedPxPerSec: 850, spinDegPerSec: 480,
      w: 50, h: 40, maxRange: 820, drawH: 52,
      dmgPct: 0.33, knockVx: 16, knockVy: -5, stun: 55,
      hitStopFrames: 6, shakeAmt: 24,
    },
    barna_ball: {
      spriteCharId: 'barna', spriteKey: 'ult_ball',
      speedPxPerSec: 950, spinDegPerSec: 720,
      w: 40, h: 40, maxRange: 820, drawH: 42,
      dmgPct: 0.33, knockVx: 16, knockVy: -5, stun: 55,
      hitStopFrames: 6, shakeAmt: 24,
    },
    // Krisz's Berserk Move projectile — the traffic cone he hurls. Lower damage than an Ultimate
    // (dmgPct 0.16 vs 0.33) since the Berserk Move recharges and can be used repeatedly per round.
    krisz_cone: {
      spriteCharId: 'krisz', spriteKey: 'cone',
      speedPxPerSec: 820, spinDegPerSec: 560,
      w: 44, h: 56, maxRange: 900, drawH: 58,
      dmgPct: 0.16, knockVx: 14, knockVy: -5, stun: 40,
      hitStopFrames: 5, shakeAmt: 18,
    },
  };
  let projectiles = [];
  function spawnProjectile(owner, typeKey, x, y){
    const cfg = PROJECTILE_TYPES[typeKey];
    if (!cfg) return;
    projectiles.push({
      typeKey, owner, x, y,
      facing: owner.facing,
      rot: 0, traveled: 0,
      dead: false,
    });
    playUltSound('charge');
  }
  function updateProjectiles(dt, p1f, p2f){
    if (projectiles.length === 0) return;
    const dtSec = dt/1000;
    projectiles.forEach(pr => {
      if (pr.dead) return;
      const cfg = PROJECTILE_TYPES[pr.typeKey];
      const dx = cfg.speedPxPerSec * pr.facing * dtSec;
      pr.x += dx;
      pr.traveled += Math.abs(dx);
      pr.rot += cfg.spinDegPerSec * pr.facing * dtSec;
      const target = pr.owner === p1f ? p2f : p1f;
      const box = { x: pr.x - cfg.w/2, y: pr.y - cfg.h/2, w: cfg.w, h: cfg.h };
      const targetBox = { x: target.x, y: target.y - target.h, w: target.w, h: target.h };
      if (target.hp > 0 && !isInvulnerable(target) && rectsOverlap(box, targetBox)){
        pr.dead = true;
        resolveProjectileHit(pr, target, cfg);
      } else if (pr.traveled >= cfg.maxRange || pr.x < -80 || pr.x > W+80){
        pr.dead = true;
        resolveProjectileMiss(pr, cfg);
      }
    });
    projectiles = projectiles.filter(pr => !pr.dead);
  }
  function resolveProjectileHit(pr, target, cfg){
    const dmg = Math.round(target.maxHp * cfg.dmgPct);
    applyDamage(target, dmg);
    target.staggerTimer = Math.max(target.staggerTimer, cfg.stun);
    target.vx = pr.facing * cfg.knockVx;
    target.vy = cfg.knockVy;
    target.onGround = false;
    resetCombo(target);
    target.hitFlash = 10;
    spawnGlassShards(pr.x, pr.y, 22);
    spawnDust(pr.x, pr.y, 12);
    hitStopTimer = cfg.hitStopFrames;
    shake = cfg.shakeAmt;
    impactFlash = cfg.hitStopFrames + 4;
    playUltSound('impact');
  }
  // missed everyone — it still shatters (same shard/dust/sound payoff, just no damage/shake/hit-stop)
  // once it reaches max range or leaves the arena, so whiffing the throw doesn't look like a silent bug
  function resolveProjectileMiss(pr, cfg){
    spawnGlassShards(pr.x, pr.y, 14);
    spawnDust(pr.x, pr.y, 8);
    playUltSound('impact');
  }
  function drawProjectiles(){
    projectiles.forEach(pr => {
      const cfg = PROJECTILE_TYPES[pr.typeKey];
      const set = sprites.ultimates[cfg.spriteCharId];
      const img = set && set[cfg.spriteKey];
      if (!(img && img.complete && img.naturalWidth > 0)) return;
      const scale = cfg.drawH / img.naturalHeight;
      const dw = img.naturalWidth*scale, dh = img.naturalHeight*scale;
      ctx.save();
      ctx.translate(pr.x, pr.y);
      ctx.rotate(pr.rot * Math.PI/180);
      ctx.drawImage(img, -dw/2, -dh/2, dw, dh);
      ctx.restore();
    });
  }

  // ---------- BERSERK MOVE MANAGER ----------
  // Meter-gated special attack that REPLACED the old timed Berserk buff (+ per-character alt-art). When
  // the Berserk meter is full (manaMs >= manaFillMs) the special button (R / O) fires this move and
  // spends the whole bar. Data-driven per character (BERSERK_MOVES) — a new character's move is just one
  // more entry here plus its own 'berserk' clip art. Two kinds:
  //   kind:'projectile' (Krisz) — plays the berserk clip; at spawnAtMs it releases a Projectile
  //         (PROJECTILE_TYPES[projectileType]) that carries all the damage/knockback (ranged move).
  //   kind:'melee' (default) — one strong close-range hit, live for [hitStartMs, hitStartMs+hitLenMs].
  //         Interim move for characters whose dedicated berserk sheet hasn't landed yet: it reuses an
  //         existing pose (`pose`) for the visuals so the button already does something meaningful.
  const BERSERK_MOVES = {
    krisz: {
      kind: 'projectile', pose: 'berserk',
      totalMs: 1040,          // matches the 8-frame krisz berserk clip (see CLIP_CONFIG.krisz.berserk)
      spawnAtMs: 760,         // the cone leaves his hand at the start of frame 7 (throw release)
      projectileType: 'krisz_cone', spawnOffset: { x: 34, y: -96 },
    },
    // --- interim melee Berserk Moves (reuse an existing pose) until each fighter's own sheet arrives ---
    tomi:  { kind: 'melee', pose: 'punch', totalMs: 520, hitStartMs: 150, hitLenMs: 130,
             hitCfg: { dmg: 18, reach: 62, knock: 9, hitStun: 28, blockStun: 14, atkType: 'high' } },
    laci:  { kind: 'melee', pose: 'punch', totalMs: 520, hitStartMs: 150, hitLenMs: 130,
             hitCfg: { dmg: 18, reach: 62, knock: 9, hitStun: 28, blockStun: 14, atkType: 'high' } },
    barna: { kind: 'melee', pose: 'kick',  totalMs: 540, hitStartMs: 160, hitLenMs: 130,
             hitCfg: { dmg: 18, reach: 66, knock: 9, hitStun: 28, blockStun: 14, atkType: 'high' } },
  };
  function berserkReady(f){
    // full bar, on the ground, and free to act (not mid-attack/throw/stagger/knockdown/ultimate/taunt)
    return f.manaMs >= f.manaFillMs && f.berserkTimer <= 0 && f.attackTimer <= 0 && f.throwTimer <= 0 &&
      f.staggerTimer <= 0 && f.blockStunTimer <= 0 && f.ultimateActive <= 0 && f.tauntTimer <= 0 &&
      !isInvulnerable(f) && f.onGround && !!BERSERK_MOVES[f.charId];
  }
  function startBerserkMove(f){
    const cfg = BERSERK_MOVES[f.charId];
    if (!cfg) return false;
    resetCombo(f);
    f.attackTimer = 0; f.throwTimer = 0;   // Berserk Move owns the fighter — cancel any normal attack
    f.attackType = 'berserk'; f.attackStepPose = null; f.attackCfg = null;
    f.berserkTimer = cfg.totalMs;
    f.berserkElapsed = 0;
    f.berserkHasHit = false;
    f.berserkSpawned = false;
    f.vx = 0;
    f.manaMs = 0;                          // spends the whole bar
    banner(`${charName(f.charId)} BERSERK! 🔥`, 55);
    playUltSound('charge');
    return true;
  }
  // Advances the Berserk Move each frame: melee hit window OR projectile release. Returns true while the
  // move is still playing (so updateFighter can skip normal movement/attack handling meanwhile).
  function updateBerserkMove(f, other, dt){
    if (f.berserkTimer <= 0) return false;
    const cfg = BERSERK_MOVES[f.charId];
    f.berserkElapsed += dt;
    f.berserkTimer -= dt;
    f.vx *= Math.pow(0.8, dt/16);          // plant in place while the move plays
    if (cfg.kind === 'projectile'){
      if (!f.berserkSpawned && f.berserkElapsed >= cfg.spawnAtMs){
        f.berserkSpawned = true;
        const ox = f.facing === 1 ? f.x + f.w + cfg.spawnOffset.x : f.x - cfg.spawnOffset.x;
        spawnProjectile(f, cfg.projectileType, ox, f.y + cfg.spawnOffset.y);
      }
    } else { // melee
      const hitOn = f.berserkElapsed >= cfg.hitStartMs && f.berserkElapsed <= cfg.hitStartMs + cfg.hitLenMs;
      if (!f.berserkHasHit && hitOn){
        const reach = cfg.hitCfg.reach;
        const bx = f.facing === 1 ? f.x + f.w : f.x - reach;
        const box = { x: bx, y: f.y - 100, w: reach, h: 70 };
        const otherBox = { x: other.x, y: other.y - other.h, w: other.w, h: other.h };
        if (rectsOverlap(box, otherBox) && other.hp > 0 && !isInvulnerable(other)){
          f.berserkHasHit = true;
          const sparkX = other.x + other.w/2, sparkY = other.y - 90;
          const blocked = resolveGuardOutcome(other, cfg.hitCfg.atkType);
          if (blocked){
            other.blockStunTimer = cfg.hitCfg.blockStun;
            other.vx += f.facing * 3;
            resetCombo(other);
            spawnSparks(sparkX, sparkY, 5);
            applyDamage(other, cfg.hitCfg.dmg * 0.2);
            hitStopTimer = 2;
          } else {
            other.staggerTimer = Math.max(other.staggerTimer, cfg.hitCfg.hitStun);
            other.vx = f.facing * (cfg.hitCfg.knock + 6);
            other.vy = -4; other.onGround = false;
            resetCombo(other);
            spawnSparks(sparkX, sparkY, 12);
            applyDamage(other, cfg.hitCfg.dmg);
            hitStopTimer = 5; shake = Math.max(shake, 14);
          }
        }
      }
    }
    if (f.berserkTimer <= 0){ f.berserkTimer = 0; f.attackType = null; }
    return true;
  }

  function updateFighter(f, other, input, dt){
    // Frame-rate-fuggetlenseg: minden "kepkockankenti" mennyiseg itt (regi-stilusu animacios
    // kockakban szamolt idozitok, sebesseg-integracio, surlodas/lassitas szorzok) dtScale-lel van
    // skalazva, hogy a valodi sebesseg/idotartam a kijelzo kepfrissitesetol fuggetlenul ugyanaz
    // maradjon. dtScale pontosan 1, ha dt=16ms (az eredeti, 60fps-t feltetelezo egy-kockas lepes),
    // tehat a referencia-utemnel semmi nem valtozik -- egy 120Hz-es kijelzon (dt~8ms) viszont mostantol
    // helyesen felakkora lepes tortenik kockankent, ahelyett hogy csendben duplajara gyorsulna minden
    // mozgas/utes/knockdown, mint korabban.
    const dtScale = dt / 16;
    if (f.hp <= 0){
      f.vx *= Math.pow(0.9, dtScale);
      f.vy += GRAVITY*dtScale; f.y += f.vy*dtScale;
      if (f.y >= GROUND_Y){ f.y = GROUND_Y; f.vy = 0; }
      return;
    }

    // Motion inputs run for HUMAN fighters only -- the CPU uses its own decision system
    // (getInput -> aiThink/trainingCpuThink). Same human/CPU split as getInput uses.
    if (!(f === p2 && (mode === '1p' || mode === 'arcade' || mode === 'training'))){
      motionUpdate(f, input, performance.now());
    }

    // Taunt: purely cosmetic, must be interrupted the instant this fighter is hit by anything (a real
    // hit-stun, a knockdown/being-thrown, or forced block-stun) -- one single guard here instead of
    // patching every individual hit-landing call site below, consistent with computeCombatState's
    // "one derived source of truth" philosophy.
    if (f.tauntTimer > 0 && (f.knockdownTimer > 0 || f.getUpTimer > 0 || f.beingThrownTimer > 0 || f.staggerTimer > 0 || f.blockStunTimer > 0)){
      f.tauntTimer = 0;
    }

    // ---- Combat System 2.0: Knockdown -> Get Up két-fázisú állapotgép ----
    // amíg knockdownTimer fut: a földön fekszik, nem irányítható, nem támadhat, sebezhetetlen.
    // amint lejár, automatikusan Get Up-ba lép (még mindig nem irányítható, még mindig sebezhetetlen),
    // és csak ennek a lejártával tér vissza Idle-be -- lásd isInvulnerable() + a lenti mozgás-tiltó ág.
    if (f.knockdownTimer > 0){
      f.knockdownTimer -= dtScale;
      if (f.knockdownTimer <= 0) f.getUpTimer = GETUP_FRAMES;
    } else if (f.getUpTimer > 0){
      f.getUpTimer -= dtScale;
    } else if (f.beingThrownTimer > 0){
      // Being Thrown: rövid "repülés" a dobás után, utána Knockdown -- ld. a Throw hit-detection lentebb
      f.beingThrownTimer -= dtScale;
      if (f.beingThrownTimer <= 0){
        f.knockdownTimer = KNOCKDOWN_FRAMES;
        // A Knockdown klip saját 8 kockája EGY TELJES "állva megütve -> földre zuhan" ívet rajzol le,
        // önmagában (ugyanúgy, mint egy közvetlen ütés utáni knockdownnál, pl. Sweep). De itt a karakter
        // a BeingThrown klip végén MÁR a földön fekszik -- ha a Knockdown ilyenkor is a saját elejétől
        // (majdnem álló testtartástól) indulna, az úgy nézne ki, mintha visszaugrana állva, majd ÚJRA
        // elesne -- ez volt a "kétszer esik el dobásnál" hiba. Ezért Throw utáni Knockdownnál a klipet
        // nem játsszuk le -- rögtön az utolsó (fekvő) kockán tartjuk, ld. posePlaybackProgress('knockdown').
        f.knockdownSkipFall = true;
      }
    }

    if (f.knockdownTimer > 0 || f.getUpTimer > 0 || f.beingThrownTimer > 0){
      // teljesen zárolt állapotok -- semmilyen input nem számít, csak a fizika/lecsengés fut tovább
      f.vx *= Math.pow(0.9, dtScale);
    } else if (f.staggerTimer > 0){
      f.staggerTimer -= dtScale;
      f.vx *= Math.pow(0.9, dtScale);
      if (f.ultimateActive > 0) f.ultimateActive = 0; // punished out of the ultimate mid-animation
      if (f.berserkTimer > 0){ f.berserkTimer = 0; f.attackType = null; } // and out of a Berserk Move
    } else if (f.ultimateActive > 0){
      // ---- Ultimate playback: the player can't cancel out of this early (no input below matters
      // until it's over), but a real hit from the opponent still knocks them out of it via the
      // staggerTimer branch above — that's what makes whiffing this move actually punishable.
      f.vx *= Math.pow(0.85, dtScale);
      // delta-time driven, not frame-counted: playback speed stays identical regardless of refresh
      // rate / dropped frames, and every pose's on-screen duration matches its configured real duration
      f.ultimateElapsed += dt;
      f.ultimateActive = Math.max(0, f.ultimateActive - dt);
      const ucfg = ULTIMATES[f.charId];
      if (ucfg){
        const info = ultimatePoseInfo(f.charId, f.ultimateElapsed);
        // generic one-shot "finale" trigger — any character can opt in via finalePoseIndex/finaleText
        // on their ULTIMATES entry; fires a banner + firework burst once, independent of whether the
        // attack itself landed (works the same for melee and projectile ultimates).
        if (ucfg.finalePoseIndex !== undefined && info.poseIndex === ucfg.finalePoseIndex && !f.ultimateFinaleShown){
          f.ultimateFinaleShown = true;
          banner(ucfg.finaleText || '', 90);
          spawnFireworks(f.x + f.w/2, f.y - f.h*0.9, 36);
          playUltSound('impact');
        }
        if (ucfg.kind === 'projectile'){
          // ---- ranged ultimate: no melee hitbox of its own — it releases a Projectile (via the
          // generic ProjectileManager below) once playback reaches the configured "throw" pose, and
          // the Projectile itself carries the damage/collision from then on, independent of this
          // fighter's animation state (it keeps flying even after the throw animation finishes).
          if (info.poseIndex === ucfg.spawnPoseIndex && !f.ultimateHasHit){
            f.ultimateHasHit = true; // reused as "already released this activation" for projectile ultimates
            const off = ucfg.spawnOffset || {x:0,y:-110};
            const sx = f.x + (f.facing === 1 ? f.w + off.x : -off.x);
            const sy = f.y + off.y;
            spawnProjectile(f, ucfg.projectileType, sx, sy);
          }
        } else {
          // ---- melee ultimate (Krisz-style): single hitbox live during one specific pose window
          const inActiveWindow = info.poseIndex === ucfg.hitPoseIndex &&
            info.msIntoPose >= ucfg.activeOffsetMs && info.msIntoPose < ucfg.activeOffsetMs + ucfg.activeLenMs;
          if (inActiveWindow && !f.ultimateHasHit){
            const box = ultimateBox(f);
            const otherBox = { x: other.x, y: other.y - other.h, w: other.w, h: other.h };
            if (rectsOverlap(box, otherBox) && other.hp > 0 && !isInvulnerable(other)){
              f.ultimateHasHit = true;
              const dmg = Math.round(other.maxHp * ucfg.dmgPct);
              applyDamage(other, dmg);
              other.staggerTimer = Math.max(other.staggerTimer, ucfg.stun);
              other.vx = f.facing * ucfg.knockVx;
              other.vy = ucfg.knockVy;
              other.onGround = false;
              resetCombo(other);
              other.hitFlash = 10;
              const sparkX = other.x + other.w/2, sparkY = other.y - 90;
              spawnSparks(sparkX, sparkY, 26);
              hitStopTimer = ucfg.hitStopFrames;
              shake = ucfg.shakeAmt;
              impactFlash = ucfg.hitStopFrames + 4;
              playUltSound('impact');
            }
          }
        }
      }
    } else if (f.tauntTimer > 0){
      // Taunt playback: locks movement/attacks (like Ultimate does) while it plays, decays in real ms,
      // and automatically falls through to Idle once it reaches 0 -- see pickPose's `tauntTimer>0`
      // branch and CLIP_CONFIG.taunt (non-looping, one-shot).
      f.vx *= Math.pow(0.85, dtScale);
      f.tauntTimer = Math.max(0, f.tauntTimer - dt);
    } else if (f.berserkTimer > 0){
      // ---- Berserk Move playback: meter-gated special attack. Locks out normal input while it plays
      // (like Ultimate/Taunt); a real hit from the opponent still knocks the fighter out of it via the
      // staggerTimer branch above. updateBerserkMove handles the melee hit window / projectile release.
      updateBerserkMove(f, other, dt);
    } else {
      // ---- Guard: külön Block gombbal, NEM automatikus. High Block (Block) / Crouch Block (Le+Block)
      // -- blockStunTimer alatt megtartjuk az utoljára beállított guardType-ot (a testtartás kényszerű).
      if (f.blockStunTimer <= 0){
        f.guardType = computeGuardType(f, input);
      }
      f.blocking = !!f.guardType || (f.blockStunTimer > 0);
      // Crouch: tiszta Le (Block nélkül) -- csak testtartás, nem blokkol
      f.crouching = f.onGround && !!input.down && !f.guardType && f.blockStunTimer <= 0;

      const speedMul = f.berserkActive > 0 ? 1.6 : 1; // Berserk: faster movement, same for every character
      if (!f.blocking && !f.crouching && f.attackTimer <= 0 && f.throwTimer <= 0){
        // Back Walk: a facing-hez képest ELLENTÉTES iránygomb tartása -- azaz a játékos az ellenféltől
        // TÁVOLODIK, miközben végig felé néz (facing itt nem változik). Csak akkor számít pózként, amíg
        // ténylegesen mozog is (ld. pickPose Math.abs(f.vx) küszöbe).
        f.movingBack = f.facing === 1 ? (!!input.left && !input.right) : (!!input.right && !input.left);
        if (input.left){ f.vx = -MOVE_SPEED*speedMul; }
        else if (input.right){ f.vx = MOVE_SPEED*speedMul; }
        else { f.vx *= Math.pow(0.75, dtScale); }
        if (input.up && f.onGround){ f.vy = JUMP_V; f.onGround = false; }
      } else {
        f.vx *= Math.pow(0.8, dtScale);
        f.movingBack = false;
      }
      // ---- Combo System + Sweep + Throw: edge-triggered (csak az ÚJ, friss gombnyomás számít, nem a
      // lenyomva tartás — ez kell a Tekken/DBFZ-szerű, pontos sorrendű kombókhoz/inputokhoz). Egy friss
      // nyomás vagy elindít egy vadonatúj kombót/ütést/Sweepet/Throw-t, vagy — ha épp kombó közben
      // vagyunk — a ComboManager dönti el (Hit Confirm + Combo Window + Input Buffer alapján), hogy
      // folytatódhat-e. ----
      // Taunt: edge-triggered (fresh press only), purely cosmetic -- only usable when the fighter is
      // completely free to act (mirrors the same gating as starting a fresh attack/Ultimate) and not
      // already taunting. See the top-of-function guard above for how a real hit cancels it early.
      const tauntPressed = input.taunt && !f._prevInput.taunt;
      if (tauntPressed && f.tauntTimer <= 0 && !f.blocking && !f.crouching && f.attackTimer <= 0 &&
          f.throwTimer <= 0 && f.staggerTimer <= 0 && f.ultimateActive <= 0){
        f.tauntTimer = tauntTotalDuration(f.charId);
      }

      // Motion-input specials: QCF+Punch -> Ultimate, QCB+Punch -> Berserk (see MOTION INPUTS).
      // Only counts when the special is actually usable; a completed motion also consumes the punch
      // press that finished it, so you don't also throw a normal punch on the same press.
      const motionUlt = f.motion.fired === 'ultimate' && canUseUltimate(f);
      const motionBsk = f.motion.fired === 'berserk' && f.manaMs >= f.manaFillMs;
      if (!f.blocking){
        const punchPressed = input.punch && !f._prevInput.punch && !(motionUlt || motionBsk);
        const kickPressed = input.kick && !f._prevInput.kick;
        // Throw input: Light + Heavy "egyszerre" -- de valódi emberi inputnál ez szinte sosem
        // pontosan ugyanabban a frame-ben történik, ezért mindkét friss nyomás egy rövid ideig
        // bufferelve marad (THROW_CHORD_WINDOW_MS), és ha a MÁSIK gomb ezen belül érkezik -- akár
        // úgy is, hogy az első már fel is engedve közben -- az is Throw-nak számít. Ez a kombináció
        // könnyen módosítható itt, ha később külön gombot kap.
        if (punchPressed) f.throwChordPunchTimer = THROW_CHORD_WINDOW_MS;
        if (kickPressed) f.throwChordKickTimer = THROW_CHORD_WINDOW_MS;
        // De: ha ez a friss gombnyomás éppen egy MÁR FOLYAMATBAN LÉVŐ kombó helyesen várt következő
        // üteme (Combo Window nyitva, és pont ez a gomb jönne a soron), az mindig elsőbbséget élvez a
        // Throw-bufferrel szemben -- különben pl. a Light Combo (Ü,Ü,R) 3. (R) üteme tévesen Throw-ként
        // sülne el, csak mert nem sokkal korábban volt egy Ü nyomás (a 2. ütés), ami még bent van a
        // bufferablakban. Ez pontosan a "Combo Limit regression" teszt által elkapott eset.
        const comboDef = f.combo.def;
        const comboHasNext = comboDef && f.combo.windowOpen && (f.combo.step + 1) < comboDef.hits.length;
        const punchContinuesCombo = punchPressed && comboHasNext && comboDef.input[f.combo.step + 1] === 'punch';
        const kickContinuesCombo = kickPressed && comboHasNext && comboDef.input[f.combo.step + 1] === 'kick';
        const throwPressed = (punchPressed && !punchContinuesCombo && f.throwChordKickTimer > 0) ||
                              (kickPressed && !kickContinuesCombo && f.throwChordPunchTimer > 0);
        // Sweep input: Le + Heavy (a rúgás friss nyomása közben lent tartva a Le gomb)
        const sweepPressed = kickPressed && !!input.down;
        const freeToAct = f.attackTimer <= 0 && f.throwTimer <= 0;
        if (throwPressed && canThrow(f)){
          // Throw Direction System: a dobás INDÍTÁSÁNAK pillanatában nézzük meg, hogy a "hátra"
          // iránygomb (a jelenlegi facing-hez képest ELLENTÉTES oldal) épp lenyomva van-e -- ha igen,
          // Back Throw, ha nem, a megszokott Forward Throw. Ezt utólag a másik irányra váltás már
          // nem írja felül (ld. startThrow -- egyszer eltárolva, a Throw végéig változatlan).
          const backHeld = f.facing === 1 ? !!input.left : !!input.right;
          startThrow(f, backHeld);
        } else if (sweepPressed && freeToAct){
          startSweep(f);
        } else if (punchPressed || kickPressed){
          const inputName = punchPressed ? 'punch' : 'kick';
          if (freeToAct && !f.combo.def){
            ComboManager.startFresh(f, inputName);
          } else if (f.throwTimer <= 0){
            ComboManager.tryAdvance(f, inputName);
          }
        }
      }
      // ---- Berserk Move: meter-gated special attack (replaced the old timed buff). Needs a FULL bar;
      // firing it (special button, or the QCB+Punch motion input) spends the whole bar and starts the
      // move (see BERSERK MOVE MANAGER). berserkReady() also enforces on-ground + free-to-act.
      if ((motionBsk || input.special) && berserkReady(f)){
        startBerserkMove(f);
      }
      if (motionUlt || (input.ultimate && canUseUltimate(f))){
        startUltimate(f);
      }
    }

    // Berserk mana regen + buff decay are both real-time (ms), not frame-counted — same delta-time
    // approach as the Ultimate system, so the 10s/20s/5s durations are exact regardless of frame rate.
    if (f.manaMs < f.manaFillMs) f.manaMs = Math.min(f.manaFillMs, f.manaMs + dt);
    // Training Mode: a Berserk csík mindig tele van (készenlétben) -- amint a Berserk lejár, a
    // canBerserk feltétel (manaMs>=manaFillMs && berserkActive<=0) azonnal újra igazzá válik, a
    // normál 10s/20s töltési időt teljesen kihagyva ("a berserk csík is mindig fel van töltödve
    // maximumra... ha berserk-et használunk és az lejár, azonnal újra használható az").
    if (mode === 'training') f.manaMs = f.manaFillMs;
    if (f.berserkActive > 0) f.berserkActive = Math.max(0, f.berserkActive - dt);
    if (f.blockStunTimer > 0) f.blockStunTimer = Math.max(0, f.blockStunTimer - dt);
    // Throw chord-buffer ablakok lejárnak, ha nem jön a másik gomb a THROW_CHORD_WINDOW_MS-en belül
    if (f.throwChordPunchTimer > 0) f.throwChordPunchTimer = Math.max(0, f.throwChordPunchTimer - dt);
    if (f.throwChordKickTimer > 0) f.throwChordKickTimer = Math.max(0, f.throwChordKickTimer - dt);
    if (f.hitFlash > 0) f.hitFlash -= dtScale;
    ComboManager.update(f, dt);

    f.vy += GRAVITY*dtScale;
    f.x += f.vx*dtScale;
    f.y += f.vy*dtScale;
    if (f.y >= GROUND_Y){ f.y = GROUND_Y; f.vy = 0; f.onGround = true; }
    f.x = Math.max(10, Math.min(W - f.w - 10, f.x));

    // ---- Back Throw: folyamatos, íves pozícióváltás (NEM teleport) ----
    // A fenti sima fizika (vx/gravity) helyett itt a megragadás pillanatában rögzített kezdő/cél X
    // között minden képkockán simán interpolálunk -- smoothstep-eléssel, hogy a dobás súlya/lendülete
    // érződjön (lassan indul, felgyorsul, a vége felé lelassul) -- a magasságot pedig egy sima
    // parabola-ív adja, hogy az ellenfél ténylegesen egy rövid ívet írjon le a támadó fölött/mellett,
    // mielőtt közvetlenül mögé landol. Ez a blokk fölülírja a fenti fizikai x/y-t, amíg tart az ív.
    if (f.throwArcActive){
      if (f.beingThrownTimer > 0){
        const t = 1 - (f.beingThrownTimer / BEING_THROWN_FRAMES); // 0 = megragadás, 1 = landolás közvetlen előtt
        const eased = t * t * (3 - 2 * t); // smoothstep
        f.x = f.throwArcStartX + (f.throwArcEndX - f.throwArcStartX) * eased;
        f.y = GROUND_Y - THROW_ARC_HEIGHT * 4 * t * (1 - t); // parabola: 0 mindkét végén, csúcs középen
        f.vy = 0; // a fizikai vy-t itt nem használjuk -- a magasságot teljesen az ív határozza meg
      } else {
        // az utolsó pillanatban pontosan a célpozícióra/talajszintre állunk, hogy ne maradjon
        // lebegő kerekítési hiba -- innen indul a Knockdown, már a végleges helyen
        f.x = f.throwArcEndX;
        f.y = GROUND_Y;
        f.vy = 0;
        f.onGround = true;
        f.throwArcActive = false;
      }
    }

    if (f.attackTimer > 0){
      f.attackTimer -= dtScale;
      const cfg = f.attackCfg;
      const duration = attackDuration(cfg);
      const elapsed = duration - f.attackTimer;
      const activeStart = cfg.startup, activeEnd = cfg.startup + cfg.active;
      if (!f.hasHit && elapsed >= activeStart && elapsed <= activeEnd){
        const box = attackBox(f);
        const otherBox = { x: other.x, y: other.y - other.h, w: other.w, h: other.h };
        // isInvulnerable(other) alatt (Knockdown / Get Up / Being Thrown) az ellenfél sebezhetetlen
        if (rectsOverlap(box, otherBox) && other.hp > 0 && !isInvulnerable(other)){
          f.hasHit = true;
          const sparkX = other.x + other.w/2, sparkY = other.y - 90;
          const atkType = cfg.atkType || 'high';
          const blocked = resolveGuardOutcome(other, atkType);
          if (blocked){
            // blokkolás: Block Stun — az ellenfél rövid ideig nem tud azonnal visszaütni, de a
            // kombó a támadó oldalán MEHET tovább (Hit Confirm = blokkolt találat is számít), a
            // védekező oldalán viszont a saját (ha lett volna) kombója megszakad
            let dmg = cfg.dmg * 0.2;
            if (f.berserkActive > 0) dmg *= 1.6; // Berserk: harder-hitting, same for every character
            other.vx += (f.facing)*2;
            other.blockStunTimer = cfg.blockStun;
            resetCombo(other);
            spawnSparks(sparkX, sparkY, 4);
            applyDamage(other, dmg);
            hitStopTimer = 1;
          } else if (cfg.knockdown){
            // Sweep (vagy bármely jövőbeli, explicit Knockdown-t okozó ütés): tiszta találat esetén
            // MINDIG azonnali Knockdown, függetlenül a kombó hitCount-tól -- ez nem kombó-lépés.
            let dmg = cfg.dmg;
            if (f.berserkActive > 0) dmg *= 1.6;
            other.knockdownTimer = KNOCKDOWN_FRAMES;
            other.knockdownSkipFall = false; // valódi ütés-eredetű Knockdown -- a teljes esés-animáció lejátszandó
            other.vx = f.facing * KNOCKDOWN_PUSH;
            other.vy = -4;
            other.onGround = false;
            resetCombo(other);
            f.vx = -f.facing * ATTACKER_SEPARATION;
            other.hitFlash = 8;
            spawnSparks(sparkX, sparkY, 9);
            applyDamage(other, dmg);
            hitStopTimer = 3;
          } else {
            f.combo.hitCount = (f.combo.hitCount || 0) + 1;
            const n = f.combo.hitCount;
            // Damage Scaling: 100% / 90% / 80% / 70% / ... egy kombóban (a TÁMADÓ saját hitCount-ja alapján)
            const dmgScale = Math.max(COMBO_DMG_FLOOR, 1 - COMBO_DMG_STEP * (n - 1));
            let dmg = cfg.dmg * dmgScale;
            if (f.berserkActive > 0) dmg *= 1.6; // Berserk: harder-hitting, same for every character
            if (n >= COMBO_LIMIT){
              // Combo Limit elérve -> Knockdown: földre esik, rövid invulnerability, aztán folytatódhat
              other.knockdownTimer = KNOCKDOWN_FRAMES;
              other.knockdownSkipFall = false; // valódi ütés-eredetű Knockdown -- a teljes esés-animáció lejátszandó
              other.vx = f.facing * KNOCKDOWN_PUSH;
              other.vy = -4;
              other.onGround = false;
              resetCombo(other);
              // a TÁMADÓ is hátralép — enélkül sarokba szorítva a pushback semmit nem ér (a fal úgyis
              // visszafogja az ellenfelet), és a támadó azonnal folytathatná az új kombót felállás után
              f.vx = -f.facing * ATTACKER_SEPARATION;
            } else {
              // Hit Stun: minden ütéshez saját (a hit config-ban megadott) bénulás-érték tartozik
              other.staggerTimer = Math.max(other.staggerTimer, cfg.hitStun);
              resetCombo(other);
              // Pushback: minden találat jobban eltolja az ellenfelet, hosszú kombó végén már távol kerülnek
              other.vx += f.facing * (cfg.knock + (n - 1) * PUSHBACK_STEP);
            }
            other.hitFlash = 8;
            spawnSparks(sparkX, sparkY, 9);
            applyDamage(other, dmg);
            hitStopTimer = 3;
          }
          // Hit Confirm: a találat (akár tiszta, akár blokkolt) megnyitja a Combo Windowt — csak ez
          // engedi a kombó folytatását, teljes mellélövés esetén ez a hívás sosem történik meg.
          // (Sweepnél / kombó nélküli ütéseknél a ComboManager.onHitConfirmed magától no-op, mert
          // f.combo.def null -- lásd a ComboManager definícióját.)
          ComboManager.onHitConfirmed(f);
        }
      } else if (!f.hasHit && elapsed > activeEnd && f.combo.def){
        // Hit Confirm sikertelen: az active ablak lezárult és semmi nem talált el — a kombó
        // véget ér itt, nem lehet végtelenül végiganimálni mellélövés után is.
        ComboManager.onWhiff(f);
      }
    }

    // ---- Throw: saját, teljesen külön idővonal (SOSEM attackTimer/attackCfg) -- nem blokkolható
    // semmilyen guarddal, csak egy dedikált startup/active/recovery ablak és saját hitbox-táv. ----
    if (f.throwTimer > 0){
      f.throwTimer -= dtScale;
      const tDuration = attackDuration(THROW_CFG);
      const tElapsed = tDuration - f.throwTimer;
      const tActiveStart = THROW_CFG.startup, tActiveEnd = THROW_CFG.startup + THROW_CFG.active;
      if (!f.throwHasHit && tElapsed >= tActiveStart && tElapsed <= tActiveEnd){
        // FONTOS: a hitbox itt UGYANAZT az "elülső éltől kifelé, reach szélességű doboz" logikát
        // követi, mint attackBox() a sima ütéseknél/rúgásoknál -- NEM a két karakter középpontja
        // közti távolságot nézzük. A karakterek szélessége (f.w = 70) miatt a középpont-távolság
        // már egymás mellett ÁLLVA (érintkezve, 0 rés) is kb. 70px, ami nagyobb a Throw korábbi
        // range-jénél (46) -- emiatt a Throw a gyakorlatban SOHA nem tudott találni, még akkor sem,
        // ha az input helyesen elindult és az animáció lefutott. Ez volt az ok, amiért a dobás
        // animációja végigment, de az ellenfél sosem repült el.
        const reach = THROW_CFG.range;
        const tbx = f.facing === 1 ? f.x + f.w : f.x - reach;
        const tbox = { x: tbx, y: f.y - 100, w: reach, h: 60 };
        const otherBox = { x: other.x, y: other.y - other.h, w: other.w, h: other.h };
        if (rectsOverlap(tbox, otherBox) && other.hp > 0 && !isInvulnerable(other) && other.throwTimer <= 0){
          f.throwHasHit = true;
          let dmg = THROW_CFG.dmg;
          if (f.berserkActive > 0) dmg *= 1.6;
          applyDamage(other, dmg);
          resetCombo(other);
          // a Throw felülír mindent az ellenfélnél -- nem blokkolható, nem megszakítható
          other.attackTimer = 0; other.blockStunTimer = 0; other.staggerTimer = 0;
          other.beingThrownTimer = BEING_THROWN_FRAMES;
          if (f.throwIsBack){
            // Back Throw: VALÓDI oldalváltás -- az ellenfél nem csak hátrafelé lökődik ugyanazon az
            // oldalon (az simán negatív irányú THROW_PUSH_VX lenne), hanem ténylegesen átkerül a
            // dobó karakter TÚLOLDALÁRA, közvetlenül mögé -- a bal/jobb sorrend felcserélődik.
            // FONTOS: itt csak a kezdő/cél X-et rögzítjük -- a TÉNYLEGES mozgás a lenti íves
            // interpolációs blokkban történik, minden képkockán egy kicsit, NEM egyetlen ugrással.
            // Landolás után a folyamatosan újraszámolt facing (ld. update()) magától egymás felé
            // fordítja mindkét felet, mert az mindig a nyers x-pozíciók alapján dől el.
            const endX = f.facing === 1 ? (f.x - other.w - THROW_BACK_GAP) : (f.x + f.w + THROW_BACK_GAP);
            other.throwArcActive = true;
            other.throwArcStartX = other.x; // a megragadás pillanatában lévő pozíció -- innen indul az ív
            other.throwArcEndX = Math.max(10, Math.min(W - other.w - 10, endX));
            other.vx = 0; // a pozíciót mostantól a lenti íves interpoláció vezérli, nem a fizikai vx/gravity
          } else {
            other.vx = f.facing * THROW_PUSH_VX;
          }
          other.vy = -3;
          other.onGround = false;
          other.hitFlash = 10;
          const sparkX = other.x + other.w/2, sparkY = other.y - 90;
          spawnSparks(sparkX, sparkY, 12);
          hitStopTimer = 4;
          shake = Math.max(shake, 3);
        }
      }
    }

    f._prevInput.punch = !!input.punch;
    f._prevInput.kick = !!input.kick;
    f._prevInput.taunt = !!input.taunt;

    f.walkPhase += Math.abs(f.vx) * 0.15 + 0.02;
    f.combatState = computeCombatState(f);
  }


  function update(dt){
    if (gameOver) return;
    updateFighter(p1, p2, getInput('p1', p1, p2, dt), dt);
    updateFighter(p2, p1, getInput('p2', p2, p1, dt), dt);
    updateProjectiles(dt, p1, p2);

    // Pushbox (átfedés-feloldás): CSAK akkor tolja szét a két karaktert, ha MINDKETTEN a talajon
    // állnak -- ha bármelyikük levegőben van (ugrás, Knockdown/Get Up/Being Thrown), az átfedést
    // engedjük, hogy cross-up ugrással át lehessen kerülni az ellenfél mögé és helyet lehessen
    // cserélni. A földi ütközés (mindkét fél a talajon) így is megmarad, csak az ugrás nem
    // "üt falba" a másik karakternél.
    if (p1.onGround && p2.onGround){
      const gap = (p1.x+p1.w) - p2.x;
      if (p1.x < p2.x && gap > 0){ p1.x -= gap/2; p2.x += gap/2; }
      else if (p2.x < p1.x){
        const gap2 = (p2.x+p2.w) - p1.x;
        if (gap2 > 0){ p2.x -= gap2/2; p1.x += gap2/2; }
      }
    }

    // Facing: minden képkockán újraszámolva, a nyers x-pozíció alapján -- ez már eleve folyamatosan
    // "az ellenfél felé" fordítja a karaktert, tehát cross-up ugrás közben/landolás után magától
    // megtörténik a fordulás, amint a pozíciók átfedik/keresztezik egymást, külön kód nélkül is.
    if (p1.staggerTimer<=0 && p1.attackTimer<=0 && p1.ultimateActive<=0 && p1.berserkTimer<=0 && p1.throwTimer<=0 && !isInvulnerable(p1) && p1.hp>0) p1.facing = p1.x < p2.x ? 1 : -1;
    if (p2.staggerTimer<=0 && p2.attackTimer<=0 && p2.ultimateActive<=0 && p2.berserkTimer<=0 && p2.throwTimer<=0 && !isInvulnerable(p2) && p2.hp>0) p2.facing = p2.x < p1.x ? 1 : -1;

    document.getElementById('hpP1').style.width = p1.hp+'%';
    document.getElementById('hpP2').style.width = p2.hp+'%';
    const specEl1 = document.getElementById('specP1'), specEl2 = document.getElementById('specP2');
    specEl1.style.width = (100*p1.manaMs/p1.manaFillMs)+'%';
    specEl2.style.width = (100*p2.manaMs/p2.manaFillMs)+'%';
    // Berserk READY: when the meter tops out it flashes red + vibrates until the Berserk Move is used
    // (manaMs drops back to 0 the instant it's spent, so the class clears itself). See .specFill.berserkReady.
    specEl1.classList.toggle('berserkReady', p1.manaMs >= p1.manaFillMs);
    specEl2.classList.toggle('berserkReady', p2.manaMs >= p2.manaFillMs);
    updateUltHud(p1, 'ultIconP1');
    updateUltHud(p2, 'ultIconP2');
    updateComboCounterUI(p1, 'comboCounterP1');
    updateComboCounterUI(p2, 'comboCounterP2');

    // Training Mode: nincs időkorlát -- a "TIME" felirat helyén az resetGame()-ben beállított "∞"
    // marad a kijelzőn, a timeLeft egyáltalán nem csökken.
    // Frame-rate-fuggetlen kor-idozito: valos ms-t gyujtunk (nem kepkocka-szamlalast), igy a kor
    // pontosan annyi VALODI masodpercig tart, amennyi be van allitva -- fuggetlenul a kijelzo Hz-jetol.
    if (mode !== 'training'){
      timerAcc += dt;
      if (timerAcc >= 1000){ timerAcc -= 1000; timeLeft--; document.getElementById('timer').textContent = Math.max(0,timeLeft); }
    }

    const uiDtScale = dt / 16;
    if (bannerTimer > 0){ bannerTimer -= uiDtScale; if (bannerTimer<=0) document.getElementById('banner').classList.remove('show'); }
    if (shake > 0) shake -= uiDtScale;
    if (impactFlash > 0) impactFlash -= uiDtScale;

    hitSparks.forEach(s=>{ s.dist += s.speed*uiDtScale; s.life -= uiDtScale; });
    hitSparks = hitSparks.filter(s=>s.life>0);

    // Training Mode: a meccs sosem ér véget KO-val vagy idővel -- csak a Szünet menü "KILÉPÉS
    // A FŐMENÜBE" gombjával lehet kilépni belőle ("végtelen ideig megy a meccs, amíg ki nem lépünk").
    if (mode !== 'training' && (p1.hp <= 0 || p2.hp <= 0 || timeLeft <= 0)){
      onRoundEnd();
    }
  }

  // when both players picked the same character, the plain name is ambiguous, so it gets an
  // explicit (P1)/(P2)/(CPU) suffix; the little emoji flavor follows the character, not the slot
  function charEmoji(id){ return id === 'krisz' ? ' 🍺' : (id === 'tomi' ? ' 💊' : (id === 'barna' ? ' ⚽' : '')); }
  function fighterLabel(f){
    const other = (f === p1) ? p2 : p1;
    const nm = charName(f.charId);
    if (other.charId === f.charId){
      const slot = (f === p1) ? 'P1' : ((mode === '1p' || mode === 'training' || mode === 'arcade') ? 'CPU' : 'P2');
      return `${nm} (${slot})`;
    }
    return nm;
  }
  // ========================================================================
  // Bo3 match flow — split into small single-purpose modules (per the request to keep this
  // extensible for online play / training mode / more rounds later):
  //   RoundManager   — win-count bookkeeping + the HUD round-win dots, nothing else
  //   CountdownManager — the 5-4-3-2-1-FIGHT! pre-round intro, owns loop() while it runs
  //   RoundEndManager  — the brief pause right after a round is decided so the win/lose pose is seen
  //   MatchManager     — what shows once the whole match (not just a round) is over
  //   RoundFlow        — the glue that resets fighters + starts the next Countdown
  // ========================================================================

  const RoundManager = {
    WINS_NEEDED: 2,
    wins: { p1: 0, p2: 0 },
    reset(){
      this.wins.p1 = 0; this.wins.p2 = 0;
      this.refreshHud();
    },
    recordRoundWin(winnerKey){ // 'p1' | 'p2' | null (draw — nobody's counter goes up)
      if (winnerKey === 'p1' || winnerKey === 'p2') this.wins[winnerKey]++;
      this.refreshHud();
    },
    isMatchOver(){ return this.wins.p1 >= this.WINS_NEEDED || this.wins.p2 >= this.WINS_NEEDED; },
    matchWinnerKey(){
      if (this.wins.p1 >= this.WINS_NEEDED) return 'p1';
      if (this.wins.p2 >= this.WINS_NEEDED) return 'p2';
      return null;
    },
    refreshHud(){
      this._renderDots('roundDotsP1', this.wins.p1, UI_ASSETS.roundDotP1);
      this._renderDots('roundDotsP2', this.wins.p2, UI_ASSETS.roundDotP2);
    },
    _renderDots(elId, winCount, filledSrc){
      const el = document.getElementById(elId);
      if (!el) return;
      el.querySelectorAll('img').forEach((img, idx) => {
        img.src = idx < winCount ? filledSrc : UI_ASSETS.roundDotEmpty;
      });
    },
  };

  const CountdownManager = (function(){
    const SEQUENCE = ['5','4','3','2','1','FIGHT!'];
    const STEP_MS = 1000;      // 5..1 each hold for a full second
    const FIGHT_HOLD_MS = 800; // "FIGHT!" holds a bit under a second
    let active = false, idx = 0, timer = 0, onDone = null;

    function el(){ return document.getElementById('countdownDisplay'); }
    function show(text){
      const e = el();
      e.textContent = text;
      e.classList.remove('show');
      void e.offsetWidth; // force a reflow so the pop-in transition restarts on every single step
      e.classList.add('show');
    }
    function start(callback){
      active = true; idx = 0; onDone = callback || null;
      timer = STEP_MS;
      EnterAnimationManager.startAll();
      show(SEQUENCE[idx]);
    }
    function update(dt){
      if (!active) return;
      timer -= dt;
      if (timer > 0) return;
      idx++;
      if (idx >= SEQUENCE.length){
        active = false;
        el().classList.remove('show');
        const cb = onDone; onDone = null;
        if (cb) cb();
        return;
      }
      timer = (SEQUENCE[idx] === 'FIGHT!') ? FIGHT_HOLD_MS : STEP_MS;
      show(SEQUENCE[idx]);
    }
    function isActive(){ return active; }
    return { start, update, isActive };
  })();

  const RoundEndManager = (function(){
    const HOLD_MS = 3200; // how long the winner/loser pose sits on screen before anything else happens
    let active = false, timer = 0, winnerKey = null, matchOver = false;

    function start(wKey, isMatchOver){
      active = true; timer = HOLD_MS; winnerKey = wKey; matchOver = isMatchOver;
    }
    function update(dt){
      if (!active) return;
      timer -= dt;
      if (timer > 0) return;
      active = false;
      document.getElementById('banner').classList.remove('show');
      if (matchOver) MatchManager.showMatchEnd(winnerKey);
      else RoundFlow.startNextRound();
    }
    function isActive(){ return active; }
    return { start, update, isActive };
  })();

  const MatchManager = {
    showMatchEnd(winnerKey){
      const n1 = fighterLabel(p1), n2 = fighterLabel(p2);
      let title, sub;
      const restartBtnEl = document.getElementById('restartBtn');
      if (mode === 'arcade'){
        // Létra-mód: győzelemnél a következő ellenfél jön (vagy a teljes menet lezárása, ha ez volt
        // az utolsó), vereségnél viszont nincs continue -- Game Over, vissza a karakterválasztásig.
        if (winnerKey === 'p1'){
          arcadeIndex++;
          if (arcadeIndex >= arcadeOpponents.length){
            title = `ARCADE MÓD TELJESÍTVE! 🏆`;
            sub = `${n1} legyőzte mind a(z) ${arcadeOpponents.length} ellenfelet!`;
            restartBtnEl.textContent = 'ARCADE ÚJRA';
            restartBtnEl.dataset.arcadeAction = 'restartLadder';
          } else {
            const nextId = arcadeOpponents[arcadeIndex];
            const nextDiff = arcadeDifficultyForIndex(arcadeIndex);
            title = `GYŐZTÉL! (${arcadeIndex}/${arcadeOpponents.length}) 🥊`;
            sub = `Következő ellenfél: ${charName(nextId)} — ${AI_DIFFICULTY[nextDiff].label}`;
            restartBtnEl.textContent = 'KÖVETKEZŐ ELLENFÉL';
            restartBtnEl.dataset.arcadeAction = 'nextOpponent';
          }
        } else {
          title = 'GAME OVER';
          sub = `Kiestél a(z) ${arcadeIndex + 1}. ellenfélnél (${charName(p2.charId)}). Nincs folytatás -- kezdd újra!`;
          restartBtnEl.textContent = 'ÚJRA AZ ELEJÉTŐL';
          restartBtnEl.dataset.arcadeAction = 'restartLadder';
        }
      } else {
        restartBtnEl.textContent = 'ÚJRAINDÍTÁS';
        delete restartBtnEl.dataset.arcadeAction;
        if (winnerKey === 'p1'){ title = `${n1} NYERTE A MECCSET! ${charEmoji(p1.charId)}`; sub = `Végeredmény: ${RoundManager.wins.p1} - ${RoundManager.wins.p2}`; }
        else if (winnerKey === 'p2'){ title = `${n2} NYERTE A MECCSET! ${charEmoji(p2.charId)}`; sub = `Végeredmény: ${RoundManager.wins.p2} - ${RoundManager.wins.p1}`; }
        else { title = 'DÖNTETLEN MECCS!'; sub = `Végeredmény: ${RoundManager.wins.p1} - ${RoundManager.wins.p2}`; }
      }
      document.getElementById('overTitle').textContent = title;
      document.getElementById('overSub').textContent = sub;
      document.getElementById('overlay').style.display = 'flex';
      // enélkül a gameState 'FIGHT' maradt volna -- sem a billentyűzet (handleMenuKeydown), sem a
      // GamepadManager (_handleMenuNav) nem foglalkozott volna ezzel a képernyővel, úgyhogy sem
      // Enterrel, sem kontrollerrel nem lehetett volna kiválasztani az ÚJRAINDÍTÁS/VISSZA gombokat
      // (csak egérrel, mert azok a click listenerek gameState-től függetlenül mindig működtek)
      gameState = 'MATCH_END';
      matchEndCursor = 0;
      renderMatchEndCursor();
    },
  };
  function renderMatchEndCursor(){
    document.getElementById('restartBtn').classList.toggle('cursor', matchEndCursor === 0);
    document.getElementById('menuBtn').classList.toggle('cursor', matchEndCursor === 1);
  }
  function confirmMatchEndOption(){
    document.getElementById(matchEndCursor === 0 ? 'restartBtn' : 'menuBtn').click();
  }
  [['restartBtn',0],['menuBtn',1]].forEach(([id,idx])=>{
    const btn = document.getElementById(id);
    btn.addEventListener('mouseenter', ()=>{ matchEndCursor = idx; renderMatchEndCursor(); });
  });

  const RoundFlow = {
    // more rounds left to play: reuses resetGame() (full HP/Ultimate/Berserk reset + fresh spawn,
    // same characters/stage) without touching RoundManager's tally, then a fresh Countdown
    startNextRound(){
      resetGame();
      lastFrameTs = null;
      CountdownManager.start();
    },
  };

  // works out who (if anyone) won the round that just ended — pure decision logic, no side effects
  // on RoundManager/overlay/etc. so it's easy to reason about and reuse
  function determineRoundOutcome(){
    const n1 = fighterLabel(p1), n2 = fighterLabel(p2);
    let title, sub, winnerKey = null;
    if (p1.hp <= 0 && p2.hp <= 0) { title = 'DÖNTETLEN KÖR!'; sub = 'Mindketten kiütve.'; }
    else if (p1.hp <= 0) { title = `${n2} NYERTE A KÖRT!`; sub = `${n1} kiütve.`; p2.resultPose = 'win'; p1.resultPose = 'lose'; winnerKey = 'p2'; }
    else if (p2.hp <= 0) { title = `${n1} NYERTE A KÖRT!`; sub = `${n2} kiütve.`; p1.resultPose = 'win'; p2.resultPose = 'lose'; winnerKey = 'p1'; }
    else if (p1.hp === p2.hp) { title = 'DÖNTETLEN KÖR!'; sub = 'Lejárt az idő, egyenlő életerő.'; }
    else if (p1.hp > p2.hp) { title = `${n1} NYERTE A KÖRT!`; sub = 'Lejárt az idő.'; p1.resultPose = 'win'; p2.resultPose = 'lose'; winnerKey = 'p1'; }
    else { title = `${n2} NYERTE A KÖRT!`; sub = 'Lejárt az idő.'; p2.resultPose = 'win'; p1.resultPose = 'lose'; winnerKey = 'p2'; }
    return { title, sub, winnerKey };
  }

  // the single entry point whenever a round ends (HP hit 0, or the clock ran out) — records the
  // round win, freezes the match on the winner/loser poses, and hands off to RoundEndManager to
  // decide (after a short beat) whether that was the whole match or just one round of it
  function onRoundEnd(){
    gameOver = true;
    // Clear any leftover hit-stop freeze from the finishing blow -- otherwise loop()'s RoundEndManager
    // branch takes priority over the hitstop-decrement branch and hitStopTimer never reaches 0 again,
    // permanently freezing animDt at 0 and stalling every fighter's Win/Lose animation on frame 1 for
    // the whole round-end hold AND the match-end screen after it (see loop()'s branch ordering below).
    hitStopTimer = 0;
    const outcome = determineRoundOutcome();
    RoundManager.recordRoundWin(outcome.winnerKey);
    const matchOver = RoundManager.isMatchOver();
    banner(outcome.title, 999999); // stays up for RoundEndManager's whole hold; hidden explicitly when it ends
    RoundEndManager.start(matchOver ? RoundManager.matchWinnerKey() : null, matchOver);
  }
  document.getElementById('restartBtn').addEventListener('click', ()=>{
    const btn = document.getElementById('restartBtn');
    const arcadeAction = btn.dataset.arcadeAction;
    if (arcadeAction === 'nextOpponent'){
      // a következő ellenfél már ki van jelölve (arcadeIndex-et showMatchEnd() már növelte) --
      // csak be kell állítani p2CharId-t/cpuDifficulty-t rá, aztán irány az ÖSSZECSAPÁS képernyő
      p2CharId = arcadeOpponents[arcadeIndex];
      cpuDifficulty = arcadeDifficultyForIndex(arcadeIndex);
      document.getElementById('overlay').style.display = 'none';
      enterVsScreen();
      return;
    }
    if (arcadeAction === 'restartLadder'){
      // Game Over vagy a teljes menet teljesítése után -- vissza a karakterválasztáshoz, friss indulás
      document.getElementById('overlay').style.display = 'none';
      enterCharacterSelect();
      return;
    }
    RoundManager.reset(); resetGame(); gameState = 'FIGHT'; lastFrameTs = null; CountdownManager.start();
  });

  // ---------- BACKGROUNDS ----------
  function drawClubBg(){
    const grd = ctx.createLinearGradient(0,0,0,H);
    grd.addColorStop(0,'#1b1440'); grd.addColorStop(0.55,'#3a2a6b'); grd.addColorStop(1,'#4b2f52');
    ctx.fillStyle = grd; ctx.fillRect(-20,-20,W+40,H+40);
    ctx.fillStyle = '#ffffff33';
    for (let i=0;i<40;i++){ ctx.fillRect((i*137)%W, (i*59)%(GROUND_Y-20), 2,2); }
    // disco ball
    const t = Date.now()/900;
    ctx.save();
    ctx.translate(W/2, 46);
    ctx.fillStyle = '#cfd8ff';
    ctx.beginPath(); ctx.arc(0,0,18,0,Math.PI*2); ctx.fill();
    for (let i=0;i<6;i++){
      ctx.strokeStyle = `hsla(${(t*60+i*60)%360},90%,70%,0.5)`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0,0);
      ctx.lineTo(Math.cos(t+i)*260, GROUND_Y-46);
      ctx.stroke();
    }
    ctx.strokeStyle = '#8890b0';
    ctx.beginPath(); ctx.moveTo(0,-24); ctx.lineTo(0,-70); ctx.stroke();
    ctx.restore();
    // ground
    ctx.fillStyle = '#160f33';
    ctx.fillRect(0, GROUND_Y+10, W, H-(GROUND_Y+10));
    ctx.strokeStyle = '#ff5fd855'; ctx.lineWidth = 2;
    for (let i=0;i<20;i++){
      ctx.beginPath(); ctx.moveTo(i*(W/20), GROUND_Y+10); ctx.lineTo(i*(W/20)-30, H); ctx.stroke();
    }
  }
  function drawPubBg(){
    const grd = ctx.createLinearGradient(0,0,0,H);
    grd.addColorStop(0,'#2a1810'); grd.addColorStop(0.55,'#4a2c18'); grd.addColorStop(1,'#5a3820');
    ctx.fillStyle = grd; ctx.fillRect(-20,-20,W+40,H+40);
    // wall planks
    ctx.strokeStyle = '#00000022'; ctx.lineWidth = 2;
    for (let i=1;i<14;i++){ ctx.beginPath(); ctx.moveTo(i*(W/14),0); ctx.lineTo(i*(W/14),GROUND_Y); ctx.stroke(); }
    // bar counter silhouette
    ctx.fillStyle = '#1c1008';
    ctx.fillRect(0, GROUND_Y-40, W, 40);
    ctx.fillStyle = '#2f1c0d';
    ctx.fillRect(0, GROUND_Y-46, W, 8);
    // hanging lamps
    for (let i=0;i<4;i++){
      const lx = (i+0.5)*(W/4);
      ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(lx,0); ctx.lineTo(lx,55); ctx.stroke();
      const glow = ctx.createRadialGradient(lx,60,2,lx,60,45);
      glow.addColorStop(0,'#ffdd8899'); glow.addColorStop(1,'#ffdd8800');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(lx,60,45,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffe9b0'; ctx.beginPath(); ctx.arc(lx,60,7,0,Math.PI*2); ctx.fill();
    }
    // bottles row
    ctx.fillStyle = '#2f5c3a';
    for (let i=0;i<16;i++){ ctx.fillRect(20+i*58, GROUND_Y-100, 10, 26); }
    // ground floor
    ctx.fillStyle = '#20140a';
    ctx.fillRect(0, GROUND_Y+10, W, H-(GROUND_Y+10));
  }
  function drawGardenBg(){
    const grd = ctx.createLinearGradient(0,0,0,H);
    grd.addColorStop(0,'#16264a'); grd.addColorStop(0.55,'#274a55'); grd.addColorStop(1,'#2f5c46');
    ctx.fillStyle = grd; ctx.fillRect(-20,-20,W+40,H+40);
    ctx.fillStyle = '#ffffff44';
    for (let i=0;i<30;i++){ ctx.fillRect((i*181)%W, (i*37)%(GROUND_Y*0.5), 2,2); }
    // string lights
    ctx.strokeStyle = '#274a3a'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x=0;x<=W;x+=20){ const y = 40+Math.sin(x/60)*14; if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); }
    ctx.stroke();
    for (let x=10;x<W;x+=45){
      const y = 40+Math.sin(x/60)*14+8;
      ctx.fillStyle = `hsl(${(x*3)%360},85%,65%)`;
      ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
    }
    // trees / bushes
    ctx.fillStyle = '#1c3324';
    [90,300,660,860].forEach((tx,i)=>{
      ctx.beginPath(); ctx.arc(tx, GROUND_Y-20, 34+((i%2)*10), 0, Math.PI*2); ctx.fill();
    });
    // fence
    ctx.fillStyle = '#3a2a1c';
    for (let x=0;x<W;x+=40){ ctx.fillRect(x, GROUND_Y-14, 8, 40); }
    ctx.fillRect(0, GROUND_Y-6, W, 6);
    // grass ground
    ctx.fillStyle = '#1e3a2a';
    ctx.fillRect(0, GROUND_Y+10, W, H-(GROUND_Y+10));
  }
  // "Akácfa Söröző" pálya: valódi fotó háttérként, "cover" illesztéssel (kitölti a vásznat,
  // a felesleget középről vágja le, nem torzítja az arányokat)
  // generic "cover" fit for a real-photo stage background: fills the whole canvas, crops any
  // excess evenly from the middle, never distorts the aspect ratio. Used by every photo stage.
  function drawPhotoBg(key, fallbackColor){
    if (!stageImages[key]) ensureStageLoaded(key); // self-heal; fallbackColor covers the decode gap
    const img = stageImages[key];
    if (!img || !img.complete || !img.naturalWidth){
      ctx.fillStyle = fallbackColor;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(W / iw, H / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }
  function drawBackground(){
    if (stage === 'akacfa') drawPhotoBg('akacfa', '#241a14');
    else if (stage === 'morrisons2') drawPhotoBg('morrisons2', '#1a1420');
    else if (stage === 'laciverse') drawPhotoBg('laciverse', '#20181c');
    else if (stage === 'siofok') drawPhotoBg('siofok', '#2a2318');
    else if (stage === 'siofok_night') drawPhotoBg('siofok_night', '#0d1220');
    else if (stage === 'novarock') drawPhotoBg('novarock', '#3a2412');
    else if (stage === 'pub') drawPubBg();
    else if (stage === 'garden') drawGardenBg();
    else drawClubBg();
  }

  // ---------- DRAW ----------
  function roundRect(x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }
  // lighten (amt>0) or darken (amt<0) a hex color, used for simple form-shading
  function shade(hex, amt){
    const c = hex.replace('#','');
    const full = c.length===3 ? c.split('').map(ch=>ch+ch).join('') : c;
    const num = parseInt(full,16);
    let r = (num>>16)+amt, g = ((num>>8)&0xff)+amt, b = (num&0xff)+amt;
    r = Math.max(0,Math.min(255,r)); g = Math.max(0,Math.min(255,g)); b = Math.max(0,Math.min(255,b));
    return `rgb(${r},${g},${b})`;
  }
  // builds a smooth tapered limb path from (x1,y1) width w1 to (x2,y2) width w2 - caller fills/strokes it
  function limbPath(x1,y1,x2,y2,w1,w2){
    const dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy)||1;
    const nx=-dy/len, ny=dx/len;
    ctx.beginPath();
    ctx.moveTo(x1+nx*w1/2, y1+ny*w1/2);
    ctx.quadraticCurveTo(x1+dx*0.5+nx*(w1+w2)/4, y1+dy*0.5+ny*(w1+w2)/4, x2+nx*w2/2, y2+ny*w2/2);
    ctx.arc(x2,y2,w2/2, Math.atan2(ny,nx), Math.atan2(-ny,-nx));
    ctx.lineTo(x1-nx*w1/2, y1-ny*w1/2);
    ctx.closePath();
  }
  // shoulder-tapered / waist-tapered torso silhouette
  function torsoPath(topW, botW, top, bot){
    const midW = Math.max(topW,botW)*0.5+3;
    ctx.beginPath();
    ctx.moveTo(-topW/2, top+4);
    ctx.quadraticCurveTo(-topW/2-2, top-2, -topW*0.32, top-2);
    ctx.quadraticCurveTo(topW*0.32, top-2, topW/2, top+4);
    ctx.quadraticCurveTo(midW, (top+bot)/2, botW/2, bot);
    ctx.quadraticCurveTo(0, bot+4, -botW/2, bot);
    ctx.quadraticCurveTo(-midW, (top+bot)/2, -topW/2, top+4);
    ctx.closePath();
  }

  function easeOutQuad(t){ return 1 - (1-t)*(1-t); }
  function easeInQuad(t){ return t*t; }

  function drawFighter(f){
    ensureFighterLoaded(f.charId); // self-heal: no-op after first load, covers any un-prewarmed fighter
    ctx.save();

    // ---- ANIMATION CONTROLLER read-out: all pose/timing state is owned by updateFighterAnimation ----
    // (see the ANIMATION CONTROLLER section) -- drawFighter never mutates animation state anymore, it
    // just renders whatever the controller decided this frame, on the game clock, not wall-clock.
    // once the match is over, update() no longer runs — let purely cosmetic timers (hit-flash/stagger)
    // keep decaying here so a fighter doesn't stay stuck flashing/dizzy forever on the end screen
    if (gameOver){
      const postGameDtScale = lastDt / 16;
      if (f.hitFlash > 0) f.hitFlash -= postGameDtScale;
      if (f.staggerTimer > 0) f.staggerTimer -= postGameDtScale;
    }

    const anim = f.anim;
    const pose = anim.pose;
    const poseAge = anim.poseTime;                     // ms of GAME time in this pose (freezes with hit-stop)
    const blend = (anim.blendLeft > 0 && anim.prevPose !== pose)
      ? 1 - anim.blendLeft / anim.blendDur             // legacy-art cross-fade still in progress
      : 1;                                             // clip-art characters always render fully switched
    const landSquash = anim.landSquashMs > 0 ? anim.landSquashMs / 180 : 0; // 0..1 landing-squash juice

    let jitterX = 0, jitterY = 0;
    if (f.berserkActive > 0 && f.charId === 'tomi' && f.hp > 0){
      jitterX = Math.sin(Date.now()/40)*6;
      jitterY = Math.abs(Math.sin(Date.now()/70))*6;
    }
    const cx = f.x + f.w/2 + jitterX;
    const baseY = f.y + jitterY; // ground-contact reference, matches physics f.y

    const person = f.charId;
    // Berserk alt-art: every character has their own full pose set (see BERSERK_SPRITE_DATA above),
    // swapped in for as long as f.berserkActive is running.
    const useSpecialArt = f.berserkActive > 0;
    const spriteSet = sprites[useSpecialArt ? (person + '_special') : person];
    // Ultimate poses ("ult1".."ult10") live in their own per-character sprite set (sprites.ultimates[id]),
    // which has no "idle" entry — so we look the pose up there first and fall back to the normal set
    // (covers both directions of the idle<->ultimate cross-fade transition).
    const ultSpriteSet = sprites.ultimates[person];
    // Enter ("spawn") poses ("enter1".."enter5") live in their own per-character sprite set too
    // (sprites.enter[id]), checked before the Ultimate set and the normal set, same reasoning.
    const enterSpriteSet = sprites.enter[person];
    // Combat System 2.0 poses (Sweep/Throw/Being Thrown/Knockdown/Get Up/Crouch) live in their own
    // per-character sprite set too (sprites.combat2[id]), checked after Enter/Ultimate (those never
    // overlap in practice) but before the normal set, same reasoning as above.
    const combat2SpriteSet = sprites.combat2[person];
    // Berserk alt-art for the same six Combat2 poses -- OPTIONAL per character (see
    // SPRITE_DATA_COMBAT2_SPECIAL above); only consulted while berserk is actually active, and only
    // if this character actually has one, so this is a no-op for characters without it.
    const combat2SpecialSpriteSet = useSpecialArt ? sprites.combat2_special[person] : null;
    // Generic multi-frame clip set (see SPRITE_DATA_CLIPS/CLIP_CONFIG above) -- OPTIONAL per character,
    // checked after Enter/Ultimate/Berserk-special (so Berserk alt-art keeps winning for every pose it
    // already covers, unchanged) but before the old Combat2/base sets, so brand-new poses with no
    // legacy or Berserk art at all (Taunt/Crouch Block/Back Walk) still resolve correctly.
    const clipSpriteSet = sprites.clips[person];
    // Current clip frame, resolved by the ANIMATION CONTROLLER's rules:
    //   - poses owned by a gameplay timer play at that timer's progress (perfect logic/visual sync,
    //     immune to hit-stop and to per-combo-hit duration differences);
    //   - locomotion poses play off the shared, speed-scaled stride phase clock (no foot-slide,
    //     no cycle restart when switching idle/walk/backwalk/run);
    //   - everything else free-runs on the pose's own game-time age.
    const clipProgress = posePlaybackProgress(f, pose);
    const isLocoCycle = pose === 'walk' || pose === 'backwalk' || pose === 'run';
    const curClip = clipFrameIndexAt(person, pose, isLocoCycle ? anim.cyclePhaseMs : poseAge, clipProgress);
    // The outgoing (fading-out) pose is frozen on its very first frame -- only ever visible for legacy
    // art (clip characters never cross-fade), where it's imperceptible during the ~110ms fade.
    const prevClip = blend < 1 ? clipFrameIndexAt(person, anim.prevPose, 0, null) : null;
    // clip-driven poses animate THEMSELVES -- gates off the procedural bob/lean/squash overlays below
    const clipDriven = !!curClip;
    const lookupPose = (p, clip) => (enterSpriteSet && enterSpriteSet[p]) ? enterSpriteSet[p] : (ultSpriteSet && ultSpriteSet[p]) ? ultSpriteSet[p] : (combat2SpecialSpriteSet && combat2SpecialSpriteSet[p]) ? combat2SpecialSpriteSet[p] : clip ? clip.img : (combat2SpriteSet && combat2SpriteSet[p]) ? combat2SpriteSet[p] : spriteSet[p];
    const img = lookupPose(pose, curClip);
    const prevImg = blend < 1 ? lookupPose(anim.prevPose, prevClip) : null;
    const flashOn = f.hitFlash > 0 && f.hitFlash % 4 < 2;
    const seed = f.animSeed;

    // ---- per-pose cosmetic transform: offset / scale / rotation ----
    // ONLY for legacy single-image-per-pose art: those poses have no motion of their own, so a
    // procedural bob/lean/squash is what brings them to life. Multi-frame clip poses (Barna) already
    // contain all of that motion IN the frames -- layering the procedural overlay on top of them made
    // the sprite bob/tilt/stretch against its own animation, which read as jerky doubled movement.
    let ox = 0, oy = 0, sx = 1, sy = 1, rot = 0;
    if (clipDriven){
      // no procedural overlay -- the frames are the animation (landing squash still applies below)
    } else if (pose === 'idle'){
      const t = Date.now()/500 + seed;
      oy = Math.sin(t) * 2.5;
      sy = 1 + Math.sin(t) * 0.015;
      sx = 1 - Math.sin(t) * 0.01;
      rot = Math.sin(t*0.6) * 0.012;
    } else if (pose === 'walk'){
      const bob = Math.abs(Math.sin(f.walkPhase));
      oy = -bob * 4;
      rot = f.facing * Math.sin(f.walkPhase) * 0.035;
      sy = 1 - bob * 0.02;
      sx = 1 + bob * 0.015;
    } else if (pose === 'run'){
      const rp = f.walkPhase * 1.5;
      const bob = Math.abs(Math.sin(rp));
      oy = -bob * 6;
      rot = f.facing * 0.1 + f.facing * Math.sin(rp) * 0.05; // constant forward lean + stride wobble
      sx = 1 + bob*0.03;
      sy = 1 - bob*0.025;
    } else if (pose === 'jump'){
      if (!f.onGround){
        if (f.vy < -2){ sy = 1.07; sx = 0.95; }              // rising
        else if (f.vy > 2){ sy = 1.03; sx = 0.98; oy = -2; } // falling
        else { sy = 1.04; sx = 0.97; }                       // near apex, floaty
      }
    } else if (pose === 'block'){
      const t = Date.now()/95 + seed;
      ox = Math.sin(t) * 1.1;
      oy = Math.abs(Math.sin(t*0.8)) * 1.2;
      rot = f.facing * Math.sin(t*0.5) * 0.01;
    } else if (pose === 'punch' || pose === 'kick'){
      // mirrors the startup/active/recovery phases of whichever hit is actually playing (a combo step
      // has its own per-hit timing, distinct from the base ATTACKS entry), so the visual windup/impact/
      // recovery always matches the real hit-detection timing
      const cfg = f.attackCfg || ATTACKS[pose];
      const duration = attackDuration(cfg);
      const t = Math.max(0, Math.min(duration, duration - f.attackTimer)) / duration;
      const activeStartT = cfg.startup/duration, activeEndT = (cfg.startup+cfg.active)/duration;
      const peak = pose === 'kick' ? 14 : 10;
      let lunge, sq;
      if (t < activeStartT){ const p = t/activeStartT; lunge = easeOutQuad(p)*peak; sq = easeOutQuad(p)*0.07; }
      else if (t < activeEndT){ lunge = peak; sq = 0.07; }
      else { const p = (t-activeEndT)/(1-activeEndT); lunge = peak*(1-easeInQuad(p)); sq = 0.07*(1-easeInQuad(p)); }
      ox = f.facing * lunge;
      sx = 1 + sq; sy = 1 - sq*0.5;
    } else if (pose === 'hit'){
      const hitT = f.hitFlash/8;
      ox = -f.facing * hitT * 8;
      rot = -f.facing * hitT * 0.06;
      sx = 1 - hitT*0.04; sy = 1 + hitT*0.03;
      if (hitT <= 0 && f.staggerTimer > 0){ rot = -f.facing*0.03; } // lingering lean during a bigger stun
    } else if (pose === 'win'){
      const t = Date.now()/260 + seed;
      const b = Math.abs(Math.sin(t));
      oy = -b * 6; sy = 1 + b*0.05; sx = 1 - b*0.02;
      rot = Math.sin(t*0.5) * 0.03;
    } else if (pose === 'lose'){
      const settle = Math.max(0, 1 - poseAge/220);
      sy = 1 - settle*0.08;
      oy = settle*4;
    }
    if (landSquash > 0 && pose !== 'jump'){
      sy -= landSquash*0.16; sx += landSquash*0.12; oy += landSquash*2;
    }

    // shadow (breathes slightly with the squash for extra weight)
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, baseY + 6, f.w * 0.42 * sx, 8, 0, 0, Math.PI*2);
    ctx.fill();

    let dh = 0;
    if (img && img.complete && img.naturalWidth > 0){
      const targetH = person === 'krisz' ? 168 : 182; // Tomi drawn a bit taller, per the ~10cm height difference
      // scale every pose off the IDLE image's own height, not this pose's own naturalHeight — poses
      // like "lose" (lying down) are much wider/shorter than a standing pose, so sizing them off their
      // own height blew them up hugely; the idle image is always the character's "true" reference size.
      const refImg = spriteSet['idle'];
      const refH = (refImg && refImg.naturalHeight) ? refImg.naturalHeight : img.naturalHeight;
      const normalScale = targetH / refH;
      // Ultimate poses use their own calibrated ultScale (see ULTIMATES doc comment above) instead of
      // the idle-height ratio, since the ultimate sheet isn't guaranteed to be drawn at the same
      // pixels-per-character-height as the main sprite sheet — this is what's picked per-image below.
      const poseScale = (poseNameForScale) => {
        const ucfg = ULTIMATES[person];
        if (ucfg && ucfg.ultScale && ultSpriteSet && ultSpriteSet[poseNameForScale]) return ucfg.ultScale;
        const ecfg = ENTER_ANIMATIONS[person];
        if (ecfg && ecfg.scale && enterSpriteSet && enterSpriteSet[poseNameForScale]) return ecfg.scale;
        if (useSpecialArt){
          const c2s = COMBAT2_POSES_SPECIAL[person];
          if (c2s && c2s.scale && combat2SpecialSpriteSet && combat2SpecialSpriteSet[poseNameForScale]) return c2s.scale;
        }
        const clipCfg = CLIP_CONFIG[person] && CLIP_CONFIG[person][poseNameForScale];
        if (clipCfg && clipCfg.scale && clipSpriteSet && clipSpriteSet[poseNameForScale]) return clipCfg.scale;
        const c2cfg = COMBAT2_POSES[person];
        if (c2cfg && c2cfg.scale && combat2SpriteSet && combat2SpriteSet[poseNameForScale]) return c2cfg.scale;
        return normalScale;
      };
      // every scale path above flows through here, so the global +15% size bump is applied in one place
      const rawPoseScale = poseScale;
      const scaledPoseScale = (p) => rawPoseScale(p) * GLOBAL_FIGHTER_SCALE;
      const scale = scaledPoseScale(pose); // used below only for the dizzy-star/scream/dance cosmetic overlays
      dh = img.naturalHeight * scale; // kept as an approximate on-screen height for the cosmetic overlays below
      ctx.save();
      ctx.translate(cx + ox, baseY + oy);
      ctx.scale(f.facing*sx, sy);
      ctx.rotate(f.facing*rot);
      // Each image is drawn at its OWN size (own scale + own pivot via getPoseAnchor), instead of both
      // the current and outgoing pose sharing one shared box/scale. The 10 Ultimate frames are tight,
      // differently shaped crops (a STOP sign or cone sticks out by a different amount each frame) —
      // forcing the outgoing frame into the incoming frame's box stretched/squashed it every pose
      // change, which is what read as "vibration". Normal (non-ultimate) poses have no calibrated
      // anchor/ultScale and fall back to the previous center/bottom pivot + idle-based scale, unchanged.
      const drawOne = (image, poseNameForAnchor, alpha, clipFrameIdx) => {
        if (!(image && image.complete && image.naturalWidth > 0) || alpha <= 0) return;
        const scale = scaledPoseScale(poseNameForAnchor);
        const idw = image.naturalWidth * scale, idh = image.naturalHeight * scale;
        const anchor = getPoseAnchor(person, poseNameForAnchor, useSpecialArt, clipFrameIdx);
        const ax = anchor ? anchor.x * scale : idw/2;
        const ay = anchor ? anchor.y * scale : idh;
        ctx.globalAlpha = alpha;
        if (flashOn){
          // tint white on an offscreen buffer first, so the white-flash never bleeds onto the game background
          const fw = Math.ceil(idw), fh = Math.ceil(idh);
          flashCanvas.width = fw; flashCanvas.height = fh;
          flashCtx.clearRect(0, 0, fw, fh);
          flashCtx.globalCompositeOperation = 'source-over';
          flashCtx.drawImage(image, 0, 0, fw, fh);
          flashCtx.globalCompositeOperation = 'source-atop';
          flashCtx.fillStyle = 'rgba(255,255,255,0.85)';
          flashCtx.fillRect(0, 0, fw, fh);
          ctx.drawImage(flashCanvas, -ax, -ay, idw, idh);
        } else {
          ctx.drawImage(image, -ax, -ay, idw, idh);
        }
        ctx.globalAlpha = 1;
      };
      if (blend < 1 && anim.prevPose !== pose){
        drawOne(prevImg, anim.prevPose, 1-blend, prevClip ? prevClip.idx : undefined);
        drawOne(img, pose, blend, curClip ? curClip.idx : undefined);
      } else {
        drawOne(img, pose, 1, curClip ? curClip.idx : undefined);
      }
      ctx.restore();
    }

    // dizzy stars while staggered
    if (f.staggerTimer > 0 && dh > 0){
      for (let i=0;i<3;i++){
        const ang = Date.now()/150 + i*(Math.PI*2/3);
        const sxp = cx + Math.cos(ang)*16;
        const syp = baseY - dh - 14 + Math.sin(ang)*6;
        ctx.fillStyle = '#ffe066';
        ctx.font = '12px sans-serif';
        ctx.fillText('★', sxp-5, syp);
      }
    }

    // Tomi's dance sparkle particles (cosmetic per-character flavor while Berserk is active)
    if (person === 'tomi' && f.berserkActive > 0 && dh > 0 && Math.random() < 0.5){
      f.danceParticles.push({x: cx + (Math.random()-0.5)*50, y: baseY - dh*0.6 + Math.random()*60, life: 30, hue: Math.random()*360});
    }
    f.danceParticles.forEach(p=>{
      ctx.fillStyle = `hsla(${p.hue},90%,65%,${p.life/30})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill();
      p.y -= 1; p.life--;
    });
    f.danceParticles = f.danceParticles.filter(p=>p.life>0);

    ctx.restore();
  }


  function drawSparks(){
    hitSparks.forEach(s=>{
      const x = s.x + Math.cos(s.angle)*s.dist;
      const y = s.y + Math.sin(s.angle)*s.dist - (s.kind==='dust' ? (s.maxLife-s.life)*0.35 : 0) // dust drifts upward
        + (s.kind==='firework' ? (s.maxLife-s.life)*0.09 : 0); // firework sparks fall back down after the burst
      const lifeRatio = s.life/(s.maxLife||16);
      if (s.kind === 'firework'){
        ctx.save();
        ctx.fillStyle = `hsla(${s.hue},95%,65%,${lifeRatio})`;
        ctx.shadowColor = `hsla(${s.hue},95%,65%,${lifeRatio*0.8})`;
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(x,y, 2.4, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      } else if (s.kind === 'shard'){
        ctx.save();
        ctx.translate(x,y);
        ctx.rotate((s.rot||0) + s.dist*0.15);
        ctx.fillStyle = `rgba(225,235,255,${lifeRatio*0.9})`;
        ctx.strokeStyle = `rgba(110,125,150,${lifeRatio})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-3,-5); ctx.lineTo(3,-3); ctx.lineTo(4,4); ctx.lineTo(-2,5); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      } else if (s.kind === 'dust'){
        ctx.fillStyle = `rgba(195,185,175,${lifeRatio*0.35})`;
        ctx.beginPath(); ctx.arc(x,y, 3+(1-lifeRatio)*5, 0, Math.PI*2); ctx.fill();
      } else {
        ctx.strokeStyle = `rgba(255,255,150,${lifeRatio})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x,y);
        ctx.lineTo(x+Math.cos(s.angle)*6, y+Math.sin(s.angle)*6);
        ctx.stroke();
      }
    });
  }

  function draw(){
    ctx.save();
    if (shake > 0){
      ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);
    }
    ctx.clearRect(-20,-20,W+40,H+40);
    drawBackground();
    drawFighter(p1);
    drawFighter(p2);
    drawProjectiles();
    drawSparks();
    // big white impact flash on an Ultimate connecting — fades out over impactFlash's remaining frames
    if (impactFlash > 0){
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, impactFlash/10)})`;
      ctx.fillRect(-20,-20,W+40,H+40);
    }
    ctx.restore();
  }

  // real elapsed time between frames — used to drive the Ultimate animation's pose timing so it plays
  // back at the same real-world speed no matter the monitor's refresh rate or any dropped frames,
  // instead of being tied to a fixed "N frames @ 60fps" counter.
  let lastFrameTs = null;
  let lastDt = 16; // legutobbi valos frame-dt (ms) -- a jatekallapoton kivuli kozmetikai lecsengesekhez (ld. drawFighter gameOver ag)
  function loop(ts){
    GamepadManager.poll(); // minden képkockán fut -- menüket és a harcot is vezérli, gameState-től függetlenül
    document.body.classList.toggle('fighting', gameState === 'FIGHT' || gameState === 'PAUSED'); // on-screen touch controls only during a match
    // the menu poster backdrop is hidden (and the fight HUD shown) whenever the game frame is on
    // screen -- the whole match incl. the KO/result overlay, not just FIGHT/PAUSED
    document.body.classList.toggle('inMatch', gameState === 'FIGHT' || gameState === 'PAUSED' || gameState === 'MATCH_END');
    if (lastFrameTs === null) lastFrameTs = ts;
    let dt = ts - lastFrameTs;
    lastFrameTs = ts;
    if (dt > 100) dt = 100; // clamp huge gaps (tab switch/lag spike) so playback can't skip several poses at once
    lastDt = dt;
    // the actual match (physics/AI/rendering) only runs while gameState === 'FIGHT' — during any
    // menu screen the canvas underneath simply isn't touched, so nothing moves or attacks there
    if (gameState === 'FIGHT'){
      // animation freezes together with hit-stop (the classic "impact freeze" -- both fighters hold
      // their exact frame for the few stopped ticks), otherwise it always advances on the same clamped
      // game-dt as physics -- see the ANIMATION CONTROLLER section
      const animDt = hitStopTimer > 0 ? 0 : dt;
      // pre-round countdown and the brief post-round pause both own the frame instead of the normal
      // update() — no physics/input runs while either is active, only rendering (draw() below) does
      if (CountdownManager.isActive()){
        EnterAnimationManager.update(p1, dt);
        EnterAnimationManager.update(p2, dt);
        CountdownManager.update(dt);
      }
      else if (RoundEndManager.isActive()){ RoundEndManager.update(dt); }
      // brief hit-stop: pause physics for a couple of frames on impact for weight/feel, rendering keeps running
      else if (hitStopTimer > 0){ hitStopTimer -= dt / 16; }
      else { update(dt); }
      // pose selection + clip clocks run once per rendered frame, AFTER game logic, BEFORE drawing --
      // so the displayed pose always reflects this frame's final state
      updateFighterAnimation(p1, animDt);
      updateFighterAnimation(p2, animDt);
      draw();
    }
    requestAnimationFrame(loop);
  }

  GamepadManager.init();
  goToMainMenu();
  requestAnimationFrame(loop);
})();

// ---------------------------------------------------------------------------
// "Add to Home Screen" nudge -- a dismissible bottom banner on the main menu that
// encourages installing the PWA. Shown ONLY on touch devices, and ONLY while running
// in a normal browser tab: if the game is already launched from the home screen
// (installed / standalone), the banner never appears. CSS gates it to body.atTitle,
// so it also disappears the moment you leave the main menu.
// ---------------------------------------------------------------------------
(function(){
  const banner = document.getElementById('a2hsBanner');
  if (!banner) return;

  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || window.navigator.standalone === true;               // iOS Safari's own flag
  const touch = window.matchMedia('(pointer: coarse)').matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem('a2hs-dismissed') === '1'; } catch(e){}

  // Not on desktop, not inside an already-installed app, and not after the user dismissed it.
  if (standalone || !touch || dismissed) return;

  // Chromium (Android) fires beforeinstallprompt -- capture it and offer a one-tap Install button.
  let deferredPrompt = null;
  const installBtn = document.getElementById('a2hsInstall');
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener('click', async function(){
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    let outcome = 'dismissed';
    try { outcome = (await deferredPrompt.userChoice).outcome; } catch(e){}
    deferredPrompt = null;
    installBtn.hidden = true;
    if (outcome === 'accepted') hide();          // keep nudging if they backed out of the prompt
  });

  function hide(){
    document.body.classList.remove('a2hs');
    try { localStorage.setItem('a2hs-dismissed', '1'); } catch(e){}
  }
  document.getElementById('a2hsClose').addEventListener('click', hide);
  // if it gets installed while open, drop the nudge immediately (and for good)
  window.addEventListener('appinstalled', hide);

  // Eligible -> let CSS reveal the banner on the main menu (body.atTitle).
  document.body.classList.add('a2hs');
})();
