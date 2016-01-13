// the semi-colon before function invocation is a safety net against concatenated
// scripts and/or other plugins which may not be closed properly.
;(function ( $, window, document, undefined ) {



   //extendable default settings
   var gameName = "fruitFall",
         defaults = {
         canvasSize: {x:640,y:690},
         fruitOnX: 8,
         dpr:window.devicePixelRatio,
         SCALE:100, //box2d likes to operate with objects from 0.1-10 meters in scale
         fruitSize:60,
         foodTypes:['peach','apple','orange','bomb'],
         gameActive: false
   };

   // The actual plugin constructor
   function Game( element, options ) {
      this.element = element;
      this.settings = $.extend( {}, defaults, options );
      this._defaults = defaults;
      this._name = gameName;


      //start game build
      this.init();
   }

   // Avoid Game.prototype conflicts
   $.extend(Game.prototype, {

         init: function () {

            //rAF fix for older browsers
            window.requestAnimFrame = (function(){
              return window.requestAnimationFrame       ||
              window.webkitRequestAnimationFrame        ||
              window.mozRequestAnimationFrame           ||
              window.oRequestAnimationFrame             ||
              window.msRequestAnimationFrame            ||
              function(callback, element){
                window.setTimeout(callback, 100/60);

              };
            })();

            //setup our sound sprites
            this.soundFX = new Howl({
              urls: ['assets/audio/gameSFX.mp3', 'assets/audio/gameSFX.ogg'],
              sprite: {
                typewriter: [0, 200],
                pencilStrike1: [300, 200],
                pencilStrike2: [600, 300],
                rustle: [1000, 1100],
                clock: [2200, 300],
                hit: [2600, 600],
                boom: [3200, 1100]
              }
            });


            //scoring
            this.score = 0;
            this.lives = 3;

             // create the pixi stage
            this.stage = new PIXI.Stage(0x66FF99);

            //create a root pixi object container in order to handle scaling/retina res/orientation/etc.
            this.scene = new PIXI.DisplayObjectContainer();
            this.stage.addChild(this.scene);


            // create a renderer instance and set size to defaults
            this.renderer = PIXI.autoDetectRenderer(defaults.canvasSize.x, defaults.canvasSize.y);


             // add the renderer view element to the DOM
             $(this.element).append(this.renderer.view);

             //start aimation ticker
             requestAnimFrame(this.animate.bind(this));


             //add listeners for screen resize and device orientation change
             //make sure renderResize function's "this" is bound to our main game object
             //so we can access our game variables
            window.addEventListener('resize', this.rendererResize.bind(this));
            window.addEventListener('deviceOrientation', this.rendererResize.bind(this));

            //trigger initial size check
            this.rendererResize();

            //create physics world
            this.physicsWorld();

            //load sprites and other assets
            this.loadAssets();
         },
         uiInit: function(){
          //initialize ui plugin
          var uiContainer = new PIXI.DisplayObjectContainer();
          this.scene.addChild(uiContainer);

          this.ui = $(this.element).gameInterface({pixiScene:uiContainer, fruitFall:this})
          .data('plugin_gameInterface');
         },
         rendererResize: function(){
            //create target scale variable
            var targetScale=1;


            //load 2X retina images and scale scene for HiDPI images if dpr is greater than 1.2
            if(defaults.dpr>1.2){
               defaults.dpr=2;
            }


            //constrain scene scale to a max of 1.0 to prevent ugly upscaled textures
            if(($(window).innerHeight() / defaults.canvasSize.y)>1 &&  
               ($(window).innerWidth() / defaults.canvasSize.x)>1){
               targetScale=1;
            }else{
               //always scale entire game to fit within viewport
               if (($(window).innerHeight() / defaults.canvasSize.y) <
                   ($(window).innerWidth()  / defaults.canvasSize.x)) {

                  //if height is greater than window height then scale proportionately based on height
                  targetScale = $(window).innerHeight()/defaults.canvasSize.y;

               } else {

                  //if width is greater than window width then scale proportionately based on width
                  targetScale = $(window).innerWidth()/defaults.canvasSize.x;

               }
            }

            //adjust physics scale to match screen size
            defaults.SCALE = defaults.SCALE/targetScale;

           
            //set our width and height variables based on our new adjusted target scale
            var width = targetScale*defaults.canvasSize.x;
            var height = targetScale*defaults.canvasSize.y;

            //resize renderer and scale scene container object based on the current device pixel ratio
            this.renderer.resize(width, height);
            this.scene.scale.x=this.scene.scale.y=targetScale/defaults.dpr;

         },
         loadAssets: function () {
            //load texture sprite sets based on device pixel ratio
            if(defaults.dpr>1.2){
               var loader = new PIXI.AssetLoader(["assets/2x/interface.json",
                                                  "assets/2x/active-items.json",
                                                  "assets/2x/explosion.json",
                                                  "assets/2x/a-o-p-rotting.json",
                                                  "assets/drips-swirlies.json"

                                                  ]);
            }else{
               var loader = new PIXI.AssetLoader(["assets/interface.json",
                                                  "assets/active-items.json",
                                                  "assets/explosion.json",
                                                  "assets/a-o-p-rotting.json",
                                                  "assets/drips-swirlies.json"]);
            }
            
           loader.onComplete = this.onLoadAssets.bind(this);
           loader.load();

         },
         onLoadAssets: function(){
            //all assets loaded
            this.staticGraphics();

            //setup ui
            this.uiInit();
         },
         staticGraphics: function(){
            var texture = PIXI.Texture.fromImage('bg'+this.spRes()+'.png');
            var paperBG = new PIXI.Sprite(texture);


            var staticContainer = new PIXI.DisplayObjectContainer();
            staticContainer.addChild(paperBG);
            this.scene.addChildAt(staticContainer,0);

         },

         spRes: function(){
            //fix sprite name for screen resolution (pixijs auto handles scaling sprites with the @2x naming convention)
            if(defaults.dpr>1.2){
              var nm='@2x';
            }else{
              var nm='';
            }
            return nm;
         },
         physicsWorld:function(){
            var SCALE = defaults.SCALE;

            //create a unique index number on fruit blocks to destroy bodies and actors
            this.uIDX = 0;

            //our body destruction container
            this.destroyBodies = [];
            //where we will store our bodies and actors
            //how we will tie pixi lib sprites to the physics lib bodies
            this.bodiesAndActors = [];

            //Earth gravity 9.8/m/s/s
            this.world = new Box2D.Dynamics.b2World(new Box2D.Common.Math.b2Vec2(0,9.8), true);


            //setup debugger canvas
            this.b2dDebug();

            //create our ficture and body definition variables
            this.fixDef = new Box2D.Dynamics.b2FixtureDef();
            this.bodyDef = new Box2D.Dynamics.b2BodyDef();

            //ground
            this.fixDef.shape = new Box2D.Collision.Shapes.b2PolygonShape();
            this.fixDef.density = 1;
            this.fixDef.shape.SetAsBox(defaults.canvasSize.x/SCALE, 10/SCALE);
            this.bodyDef.position.Set(0,(defaults.canvasSize.y-30)/SCALE);
            var ground = this.world.CreateBody(this.bodyDef);
            ground.userData = {};
            ground.userData.name='ground';
            ground.CreateFixture(this.fixDef);


            //left wall
            this.fixDef.shape = new Box2D.Collision.Shapes.b2PolygonShape();
            this.fixDef.density = 1;
            this.fixDef.shape.SetAsBox(10/SCALE, defaults.canvasSize.y/SCALE);
            this.bodyDef.position.Set(30/SCALE,0);
            var wallL = this.world.CreateBody(this.bodyDef);
            wallL.userData = {};
            wallL.userData.name='wall';
            wallL.CreateFixture(this.fixDef);

            //right wall
            this.fixDef.shape = new Box2D.Collision.Shapes.b2PolygonShape();
            this.fixDef.density = 1;
            this.fixDef.shape.SetAsBox(10/SCALE, defaults.canvasSize.y/SCALE);
            this.bodyDef.position.Set((defaults.canvasSize.x-30)/SCALE,0);
            var wallR = this.world.CreateBody(this.bodyDef);
            wallR.userData = {};
            wallR.userData.name='wall';
            wallR.CreateFixture(this.fixDef);

            //randomly generate some fruit falling
            this.randomFruitFall();

            this.getBodyOnClick();

            //add box2d collision listeners
            var listener = new Box2D.Dynamics.b2ContactListener;
            listener.BeginContact = function(contact){
                ref.ui.randomSwirlsAndDrips( (contact.GetFixtureA().GetBody().GetPosition().x*defaults.SCALE),
                  (contact.GetFixtureA().GetBody().GetPosition().y*defaults.SCALE) )

            }
            listener.EndContact = function(contact){
              
            }
            listener.PostSolve = function(contact, impulse){
              //only play hit sound when impulse of hit is greater than a set amount
              if(impulse.normalImpulses[0]>1){
                ref.soundFX.play('hit');
              }
              
            }
            listener.PreSolve = function(contact, oldManifold){
              var fixA = contact.GetFixtureA().GetBody();
              var fixB = contact.GetFixtureB().GetBody();

              if( (fixA.userData.xRow!=fixB.userData.xRow) &&
                 (fixA.GetType()!=Box2D.Dynamics.b2Body.b2_staticBody) &&
                 (fixB.GetType()!=Box2D.Dynamics.b2Body.b2_staticBody) 
                ){

                contact.SetEnabled(false);

              }else{
                contact.SetEnabled(true);
              }
            }

            this.world.SetContactListener(listener);

            var ref=this;
            //handle custom kill event trigger
            $(ref.element).on('kill_fruits',function(e,data){
              switch(data._type){
                case 'bomb_blast': //if bomb blast trigger, life lost and destroy nearby blocks
                if(ref.lives>0){
                  ref.lives--;
                  ref.updateScoreboard('life_change', ref.lives);
                }else{
                  ref.endGame();
                }

                ref.soundFX.play('boom');
                ref.blastRadius(data._body.GetPosition().x, data._body.GetPosition().y);
                break;
                default:
                ref.destroyBodiesAndActors(data._body);
                }
      
            });


         },

         randomFruitFall:function(){

          var ref = this;
          var randomFruitTM = 0;
          (function loop(){
            if(ref.settings.gameActive==true){
            var rand = Math.round(Math.random()* (1000-500))+500;

            randomFruitTM = setTimeout(function(){
              //randomly generate falling fruit/enemy blocks
              var randomFruit = Math.round(Math.random()*(defaults.foodTypes.length-1));

              //random x position based on fruit size add  1 pixel so they don't bounce off each other;
              var fruitOnXRand = Math.round((Math.random()*defaults.fruitOnX));
              var randomX = Math.round((defaults.fruitSize)*fruitOnXRand);

              var rowCollision = fruitOnXRand%2;

              ref.createBlock(75+randomX, defaults.foodTypes[randomFruit], rowCollision);

              loop();

            },rand);
          }else{
            clearTimeout(randomFruitTM);
            randomFruitTM=null;
          }

          }());

         },
         beginGame: function(){
          //randomly generate some fruit falling/start game play
          this.settings.gameActive=true;
          this.randomFruitFall();
         },
         restartGame:function(){
          //clear all fruit blocks and score boards
          for(var bb = this.world.GetBodyList();bb;bb=bb.GetNext()){
            //loop through all the bodies and destroy only dynamic bodies
            if(bb.GetType() != Box2D.Dynamics.b2Body.b2_staticBody){
              this.destroyBodiesAndActors(bb);
            }
          }
          //reset score and lives
          //trigger event listener to tell interface to redraw
          this.updateScoreboard('score_change', 0);
          this.updateScoreboard('life_change', 3);

          this.ui.beginCountdown();
         },
         updateScoreboard: function(_type, _num){
          //just update scores/lives and trigger event (we'll be handling these events in the interface.js script)
          switch(_type){
            case 'score_change':
            this.score=_num;
            $(this.element).trigger('score_change',this.score);
            break
            case 'life_change':
            this.lives=_num;
            $(this.element).trigger('life_change',this.lives);
            break;
            default:
            //defaults
          }

         },
         destroyBodiesAndActors: function(body){
          var theIDX = body.idx;
          var pixiBody;

          for(var i=0;i<this.bodiesAndActors.length;i++){
            if(this.bodiesAndActors[i][0].idx==theIDX){
              pixiBody = this.bodiesAndActors[i][1];
              pixiBody.parent.removeChild(pixiBody);
              this.bodiesAndActors.splice(i,1);
              break;
            }
          }
          this.destroyBodies.push(body);
         },
         endGame:function(){
          this.ui.gameOver();
          this.settings.gameActive=false;
         },
         createBlock: function(xPos, itemType, rowCollision){
          //setup initial fixture vars, play with this until you have proper weight/interaction
          var SCALE = defaults.SCALE;
          var ref=this;
          this.fixDef.density = 1;
          this.fixDef.restitution = 0.5;
          this.fixDef.friction = 0.5;

          //make sure we are using a dynamic body
          this.bodyDef.type = Box2D.Dynamics.b2Body.b2_dynamicBody;

          //divide fruit size by 2, SetAsBox uses half-measurements;
          var blockScale = defaults.fruitSize/2;

          //setup the shape and position
          this.fixDef.shape.SetAsBox(blockScale/SCALE, blockScale/SCALE);
          this.bodyDef.position.Set(xPos/SCALE, -blockScale/SCALE);

          //create block body, give it a user data object and add the item type name(apple, pear, etc)
          var theBlock = this.world.CreateBody(this.bodyDef);
          theBlock.CreateFixture(this.fixDef);
          theBlock.userData = {};
          theBlock.userData.name=itemType;
          theBlock.userData.xRow = rowCollision;

          //create pixi body based on type
          var pixiContainerSprite = new PIXI.DisplayObjectContainer();
          var pixiSprite = new PIXI.Sprite.fromImage(itemType+this.spRes()+'.png');
          pixiSprite.anchor.x=pixiSprite.anchor.y = 0.5;
          pixiContainerSprite.position.y = -200;
          pixiContainerSprite.addChild(pixiSprite);
          pixiContainerSprite.addChild(pixiSprite);
          this.scene.addChild(pixiContainerSprite);

          var animatedSprite = this.addAnimation(itemType,pixiContainerSprite, theBlock);

          //add individual functionality to sprite
          switch(itemType){
            case 'bomb':
            pixiSprite.position.x=-5;
            pixiSprite.rotation=-0.05;
            TweenMax.to(pixiSprite, 0.05,{rotation:0.05,yoyo:true,repeat:-1});
            break;
            case 'orange':
            pixiSprite.position.x=5;
            break;
            case 'apple':
            pixiSprite.position.y=-3;
            break
            default:
            pixiSprite.position.x=0;
          }

          //need to know where to remove the matching actor based on body idx
          theBlock.idx = this.uIDX;

          this.bodiesAndActors.push([theBlock,pixiContainerSprite]);
          //and increment uIDX
          this.uIDX+=1;


          //if itemType is a bomb then we want to destroy nearby blocks
          if(itemType=='bomb'){
            setTimeout(function(){
              if(ref.settings.gameActive){
              //if not tagged for removal then explode bomb
              if(theBlock.userData.discovered!=true){
                animatedSprite.playAndKill(ref.element,'bomb_blast');
              }

            }else{
              return false;
            }

            },4000);
          }else{
            //else fruit should auto die after 15-25 seconds of life
            setTimeout(function(){
              if(ref.settings.gameActive){
                  animatedSprite.playAndKill(ref.element,'fruit_rot');
              }else{
                return false;
              }
              
            }, (Math.random()*10+5)*2000);
          }

          //create a prismatic joint to pin block movement to the y axis only
          var b2Vec2 = Box2D.Common.Math.b2Vec2;
          this.blockPrismaticJoint({
            world: this.world,
            axis:new b2Vec2(0.0,1.0), // pin only to the Y axis
            bodyA: theBlock,
            bodyB: this.world.GetGroundBody()
          });

         },
         addAnimation:function(itemType, theContainer, theBody){
          //movieclip offset fixes
          var xPosOffset = 0;
          switch(itemType){
            case 'bomb':
            var spriteAni='explosion';
            var ttl=31;
            xPosOffset=-7;
            break;
            default:
            var spriteAni=itemType+'-rot';
            var ttl=9;
            xPosOffset=0;
          }

          var zeros='0000';
          var animationTextures = [];

          for(var i=0;i<=ttl;i++){
            //fix naming convention (0009,0010,0100);
            zeros = ('0000').substring(0,4-String(i).length);

            var texture = PIXI.Texture.fromFrame(spriteAni+this.spRes()+zeros+i+".png");
            animationTextures.push(texture);
          }

          //create an animated bomb/rot MovieClilp based on our extended movieclip functionality
          var animation = new PIXI.FruitMC(animationTextures);
          animation.anchor.x=animation.anchor.y=0.5;

          animation.position.x=xPosOffset;
          animation.position.y=3;
          animation.loop=false;
          animation.gotoAndStop(0);
          animation.visible=false;
          theContainer.addChild(animation);


          animation.container = theContainer;
          animation.defaultSprite = theContainer.getChildAt(0);
          animation.physicsBody=theBody;

          return animation;

         },
         blockPrismaticJoint: function(state){
          //basic prismatic joint just to lock on Y axis without any limits
          var jointDef = new Box2D.Dynamics.Joints.b2PrismaticJointDef();
          jointDef.Initialize(state.bodyA, state.bodyB, state.bodyA.GetWorldCenter(), state.axis);
          this.world.CreateJoint(jointDef);

         },
         blastRadius: function(xPoint, yPoint){
          //create collision rectangle around blast radius
          var blockPos = new Box2D.Common.Math.b2Vec2(xPoint, yPoint);
          var aabb = new Box2D.Collision.b2AABB();
          aabb.lowerBound.Set(xPoint-0.5, yPoint-0.5);
          aabb.upperBound.Set(xPoint+0.5, yPoint+0.5);

          //test if there are any AABBs (axis-aligned bounding boxes) within the blast rectangle area
          var body;
          var ref = this;
          this.world.QueryAABB(
            //the fixture that was successfully queried
            function(fixture)
            {
                //only get bodies that are dynamic (we don't want to destroy walls or floor)
                if(fixture.GetBody().GetType() != Box2D.Dynamics.b2Body.b2_staticBody)
                {
                    body = fixture.GetBody();
                    //destroy body and find next body within radius
                    ref.destroyBodiesAndActors(body);
                }
                return true;
            }, aabb);


         },
         getBodyOnClick: function(){
              var ref = this;

              $(document).on('dblclick', function(e){
                //find body at mouse position where double clicked
                var clickedB = ref.getBodyAtMouse(e.clientX/ref.settings.SCALE, e.clientY/ref.settings.SCALE);

                //if you successfully double clicked on a body start removal logic
                if(clickedB){
                  clickedB.userData.discovered = true;
                  ref.score++;

                  //create array to add all matching blocks for destruction
                  ref.destroyBodiesAndActors(clickedB);

                  //get all contacts of clicked body
                  var edge = clickedB.GetContactList();

                  //function to loop through and tag discovered bodies starting from clicked body
                  function matchOther(startB){
                    var edge = startB.GetContactList();
                    while(edge){
                      var other = edge.other;
                      //if other is of same fruit type as clicked body and hasn't been discovered
                      //add to removal list, tas as discovered and loop hrough next set of contacts
                      if(other.userData.name==clickedB.userData.name && other.userData.discovered!=true){
                        //make sure objects are actually touching (not just their aabbs);
                        if(edge.contact.IsTouching()){
                          other.userData.discovered = true;
                          ref.destroyBodiesAndActors(other);
                          matchOther(other);
                          ref.score++;
                        }
                      }
                      edge = edge.next;
                    }
                  }
                  matchOther(clickedB);
                  ref.updateScoreboard('score_change',ref.score);
                }


              });
          },
          getBodyAtMouse: function(xPoint,yPoint){
            //create collision rectangle around mouse pointer position

          var mousePos = new Box2D.Common.Math.b2Vec2(xPoint, yPoint);
          var aabb = new Box2D.Collision.b2AABB();
          aabb.lowerBound.Set(xPoint-0.001, yPoint-0.001);
          aabb.upperBound.Set(xPoint+0.001, yPoint+0.001);

          //test if there are any AABBs (axis-aligned bounding boxes) within the blast rectangle area
          var body;
          this.world.QueryAABB(
            //the fixture that was successfully queried
            function(fixture)
            {
                //only get bodies that are dynamic (we don't want to destroy walls or floor)
                if(fixture.GetBody().GetType() != Box2D.Dynamics.b2Body.b2_staticBody)
                {
                  if(fixture.GetShape().TestPoint(fixture.GetBody().GetTransform(), mousePos)){
                    //only get bodies under the mouse point pos
                    body = fixture.GetBody();
                    return false;
                  }
                }
                return true; //keep going until we find a match;
            }, aabb);
            return body;
          },
         b2dDebug:function(){
          //setup debug draw
          var debugDraw = new Box2D.Dynamics.b2DebugDraw();
          var debugCV = $('#dbc');
          debugCV.attr('height',defaults.canvasSize.y);
          debugCV.attr('width',defaults.canvasSize.x);

          debugDraw.SetSprite(document.getElementById('dbc').getContext('2d'));

          //scale our debug graphics and set alpha transparency
          debugDraw.SetDrawScale(100);
          debugDraw.SetFillAlpha(0.2);
          //list of flags to show in our debug canvas, we are showing shapes and joints
          debugDraw.SetFlags(
            Box2D.Dynamics.b2DebugDraw.e_shapeBit |
            Box2D.Dynamics.b2DebugDraw.e_jointBit | Box2D.Dynamics.b2DebugDraw.e_aabbBit
            );

          this.world.SetDebugDraw(debugDraw);


         },
         animate: function(){
          //animating the physics world
          this.world.Step(1/60, //Set to the Box2D manual's suggested 60hz time step
            8, //default velocity iterations
            3 //default position iterations
            //more iterations == more accuracy but requires more processing
            );

          this.world.DrawDebugData();
          this.world.ClearForces();

            requestAnimFrame(this.animate.bind(this));

           // render the stage
           this.renderer.render(this.stage);

           //match pixi sprites to physics bodies
           var n =this.bodiesAndActors.length;
           for(var i=0;i<n;i++){
            var body = this.bodiesAndActors[i][0];
            var actor = this.bodiesAndActors[i][1];
            actor.position.x = body.GetPosition().x*defaults.SCALE;
            actor.position.y = body.GetPosition().y*defaults.SCALE;
           }

           //destroy all bodies in destroy list
           //have to wait until box2d unlocks your bodies, send bodies to a destruction list to be
           //destroyed in you animation step function
           for(var i=0;i<this.destroyBodies.length;i++){
            this.world.DestroyBody(this.destroyBodies[i]);
           }

           //make sure to clear out yuor array after bodies have been destroyed
           this.destroyBodies = [];



         }

   });

   // A really lightweight plugin wrapper around the constructor,
   // preventing against multiple instantiations
   $.fn[ gameName ] = function ( options ) {
      this.each(function() {
            if ( !$.data( this, "plugin_" + gameName ) ) {
                  $.data( this, "plugin_" + gameName, new Game( this, options ) );
            }
      });

      // chain jQuery functions
      return this;
   };

})( jQuery, window, document );


