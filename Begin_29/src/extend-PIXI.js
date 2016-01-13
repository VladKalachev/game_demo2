//extend PIXI.MovieClip with FruitMC, handles animation and removal of the 
//box2d based fruit bodies and attached sprites
PIXI.FruitMC = function(textures){
	PIXI.MovieClip.call(this, textures);

	//setup some additional vars for the animation container, our default static image, ad the attached physics body
	this.container;
	this.defaultSprite;
	this.physicsBody;
}


PIXI.FruitMC.constructor = PIXI.FruitMC;
PIXI.FruitMC.prototype = Object.create(PIXI.MovieClip.prototype);

PIXI.FruitMC.prototype.playAndKill = function(element, type){
	var ref = this;

	//switch out movieclip visibility and start playing the animation
	this.defaultSprite.visible=false;
	this.visible=true;
	this.gotoAndPlay(0);

	//trigger a kill event to remove both b2d body and fruit on animation over
	var detectFrameEnd = setInterval(function(){
		if(ref.currentFrame==ref.totalFrames-1){
			$(element).trigger('kill_fruits', {_type:type,_body:ref.physicsBody});
			clearInterval(detectFrameEnd);
			detectFrameEnd=null;
		}
	},1000/60);
}