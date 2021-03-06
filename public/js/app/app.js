App = Ember.Application.create();

App.ShowSpinnerWhileRendering = Ember.Mixin.create({
  layout: Ember.Handlebars.compile('<div {{bindAttr class="isLoaded"}}>{{ yield }}</div>'),

  classNameBindings: ['isLoaded::loading'],

  isLoaded: function() {
    return this.get('isInserted') && App.postsController.isLoaded;
  }.property('isInserted', 'App.postsController.isLoaded'),

  didInsertElement: function() {
    this.set('isInserted', true);
    this._super();
  }
});

App.PaginationHelper = Em.Mixin.create({
  pageSize: 25,
  pageStart: 0,

  nextPage: function() {
    this.incrementProperty('pageStart', this.get('pageSize'))
  },

  prevPage: function() {
    this.decrementProperty('pageStart', this.get('pageSize'))
  },

  prevPageDisabled: function() {
    return App.postsController.get('pageStart') == 0 ? 'disabled' : ''
  }.property('App.postsController.pageStart'),

  prevPageVisible: function() {
    return this.get('prevPageDisabled') != 'disabled'
  }.property('App.postsController.pageStart'),

  nextPageVisible: function() {
    return this.get('nextPageDisabled') != 'disabled'
  }.property('App.postsController.content'),

  nextPageDisabled: function() {
    var len = this.get('content.content.length')
    return len == 0 || len < this.get('pageSize') ? 'disabled' : ''
    // TODO: bind to generic content
  }.property('App.postsController.content'),

  resetPage: function() {
    this.set('pageStart', 0)
  },

  pageDidChange: function() {
    this.didRequestRange(this.get('pageStart'));
  }.observes('pageStart')
});

App.Pagination = Ember.View.extend({
  templateName: 'pagination'
});

App.Subscription = Ember.Object.extend({
  socket: null,
  subscribedTo: {},

  init: function() {
    var that = this
    var findPost = function(postId) {
      switch (App.router.currentState.name) {
      case "aPost":
        if (App.onePostController.content.id == postId)
          return App.onePostController.content
        break;
      case "posts":
      case "userTimeline":
        return App.postsController.find(function(post) {
          return post.id == postId
        })
        break;
      }
    }

    this.socket = io.connect('/');

    this.socket.on('newPost', function (data) {
      var post = App.Post.create(data.post)

      App.postsController.addObject(post)
    });

    this.socket.on('updatePost', function(data) {
    })

    this.socket.on('destroyPost', function(data) {
      App.postsController.removePost('id', data.postId)
    })

    this.socket.on('newComment', function (data) {
      var comment = App.Comment.create(data.comment)

      var post = findPost(data.comment.postId)

      if (post) {
        post.comments.pushObject(comment)
      } else {
        var post = App.postsController.findOne(data.comment.postId)
        App.postsController.addObject(post)
      }
    });

    this.socket.on('newLike', function(data) {
      var user = App.User.create(data.user)

      var post = findPost(data.postId)

      if (post) {
        var like = post.likes.find(function(like) {
          return like.id == user.id
        })

        if (!like) {
          post.likes.pushObject(user)
        }
      } else {
        var post = App.postsController.findOne(data.postId)
        App.postsController.addObject(post)
      }
    })

    this.socket.on('removeLike', function(data) {
      var post = findPost(data.postId)

      if (post) {
        post.removeLike('id', data.userId)
      }
    })

    this.socket.on('updateComment', function(data) {
    })

    this.socket.on('destroyComment', function(data) {
    })

    this.socket.on('disconnect', function(data) {
      that.reconnect()
    })
  },

  subscribe: function(channel, id) {
    this.subscribedTo[channel] = id;
    this.socket.emit('subscribe', this.subscribedTo);
  },

  unsubscribe: function() {
    this.socket.emit('unsubscribe', this.subscribedTo)
  },

  reconnect: function() {
    var subscribedTo = this.get('subscribedTo')
    this.unsubscribe()
    this.subscribe(subscribedTo)
  }
})

App.ApplicationView = Ember.View.extend(App.ShowSpinnerWhileRendering, {
  templateName: 'application'
});
App.ApplicationController = Ember.Controller.extend({
  subscription: null,

  init: function() {
    App.ApplicationController.subscription = App.Subscription.create()
  }
});

// Index view to display all posts on the page
App.PostsView = Ember.View.extend({
  templateName: 'post-list-view',

  submitPost: function() {
    App.postsController.submitPost()
    // dirty way to restore original height of post textarea
    this.$().find('textarea').height('56px')
  }
});

// Create new post text field. Separate view to be able to bind events
App.CreatePostView = Ember.TextArea.extend(Ember.TargetActionSupport, {
  attributeBindings: ['class'],
  classNames: ['autogrow-short'],

  // TODO: Extract value from controller 
  valueBinding: 'App.postsController.body', 

  insertNewline: function() {
    this.triggerAction();
    // dirty way to restore original height of post textarea
    this.$().find('textarea').height('56px') 
  },

  didInsertElement: function() {
    this.$().autogrow();
  }
})

App.JustStarted = Ember.View.extend({
  templateName: 'just-started',

  didInsertElement: function() {
    this.$().hide().slideDown();
  },

  // willDestroyElement: function() {
  //   var clone = this.$().clone();
  //   this.$().replaceWith(clone);
  //   clone.slideUp()
  // },

  justStarted: function() {
    return App.router.location.lastSetURL != "/users/anonymous"
  }.property()
});

App.UploadFileView = Ember.TextField.extend({
  type: 'file',

  didInsertElement: function() {
    this.$().prettyInput()
  }
});

// View to display single post. Post has following subviews (defined below):
//  - link to show a comment form
//  - form to add a new comment
App.PostContainerView = Ember.View.extend({
  templateName: 'post-view',
  isFormVisible: false,

  toggleVisibility: function() {
    this.toggleProperty('isFormVisible');
  },

  didInsertElement: function() {
    // wrap anchor tags around links in post text
    this.$().find('.text').anchorTextUrls();
    // please read https://github.com/kswedberg/jquery-expander/issues/24
    this.$().find('.text').expander({
      slicePoint: 350,
      expandPrefix: '&hellip; ',
      preserveWords: true,
      expandText: 'more&hellip;',
      userCollapseText: '',
      collapseTimer: 0,
      expandEffect: 'fadeIn',
      collapseEffect: 'fadeOut'
    })

    this.$().hide().slideDown('slow');
  },

  // willDestroyElement: function() {
  //   if (this.$()) {
  //     var clone = this.$().clone();
  //     this.$().replaceWith(clone);
  //     clone.slideUp()
  //   }
  // },

  showAllComments: function() {
    this.content.set('showAllComments', true)
  },

  unlikePost: function() {
    App.postsController.unlikePost(this.content.id)
  }
});

// View to display single post. Post has following subviews (defined below):
//  - link to show a comment form
//  - form to add a new comment
App.OwnPostContainerView = Ember.View.extend({
  templateName: 'own-post-view',
  isFormVisible: false,

  toggleVisibility: function() {
    this.toggleProperty('isFormVisible');
  },

  didInsertElement: function() {
    // wrap anchor tags around links in post text
    this.$().find('.text').anchorTextUrls();
    // please read https://github.com/kswedberg/jquery-expander/issues/24
    this.$().find('.text').expander({
      slicePoint: 350,
      expandPrefix: '&hellip; ',
      preserveWords: true,
      expandText: 'more&hellip;',
      userCollapseText: '',
      collapseTimer: 0,
      expandEffect: 'fadeIn',
      collapseEffect: 'fadeOut'
    })

    this.$().hide().slideDown('slow');
  },

  // willDestroyElement: function() {
  //   if (this.$()) {
  //     var clone = this.$().clone();
  //     this.$().replaceWith(clone);
  //     clone.slideUp()
  //   }
  // },

  showAllComments: function() {
    this.content.set('showAllComments', true)
  },

  unlikePost: function() {
    App.postsController.unlikePost(this.content.id)
  }
});

App.CommentContainerView = Ember.View.extend({
  templateName: 'comment-view',

  didInsertElement: function() {
    // wrap anchor tags around links in comments
    this.$().find('.body').anchorTextUrls();
    this.$().find('.body').expander({
      slicePoint: 512,
      expandPrefix: '&hellip; ',
      preserveWords: true,
      expandText: 'more&hellip;',
      userCollapseText: '',
      collapseTimer: 0,
      expandEffect: 'fadeIn',
      collapseEffect: 'fadeOut'
    })

    this.$().hide().slideDown('fast');
  }
})

// Create new post text field. Separate view to be able to bind events
App.CommentPostView = Ember.View.extend(Ember.TargetActionSupport, {
  click: function() {
    this.triggerAction();
  },

  // XXX: this is a dup of App.PostContainerView.toggleVisibility()
  // function. I just do not know how to access it from UI bindings
  toggleVisibility: function() {
    this.toggleProperty('parentView.isFormVisible');
  }
})

App.LikePostView = Ember.View.extend(Ember.TargetActionSupport, {
  click: function() {
    this.triggerAction();
  },

  likePost: function() {
    // XXX: rather strange bit of code here -- potentially a defect
    var post = this.bindingContext.content || this.bindingContext
    App.postsController.likePost(post.id)
  }
})

App.LikeView = Ember.View.extend({
  templateName: 'like-view',
  tagName: 'li',
  classNameBindings: ['isLastAndNotSingle:last', 'isFirstAndSingle:first'],
  classNames: ['pull-left'],

  isFirstAndSingle: function() {
    // NOTE: this is a hacky way to get updated content index -- when
    // element is removed from the observed array content indexes are
    // not updated yet, hence latest index could be bigger than total
    // number of elements in the collection. Same workarround is
    // applied in isLastAndNotSingle function below.

    //var index = this.get('contentIndex')+1

    var currentId = this.get('content.id')
    var index, i = 0
    this.get('_parentView.content').forEach(function(like) {
      if (like.id == currentId) { index = i; return; }
      i += 1
    })
    var length = this.get('parentView.content.length')
    return index == 0 && length == 1
  }.property('parentView', 'parentView.content.@each'),

  isLastAndNotSingle: function() {
    var currentId = this.get('content.id')
    var index, i = 1
    this.get('_parentView.content').forEach(function(like) {
      if (like.id == currentId) { index = i; return; }
      i += 1
    })
    var length = this.get('parentView.content.length')

    return index == length && length > 1
  }.property('parentView', 'parentView.content.@each')
});

App.CommentPostViewSubst = Ember.View.extend(Ember.TargetActionSupport, {
  classNameBindings: 'isVisible visible:invisible',

  click: function() {
    this.triggerAction();
  },

  // XXX: this is a dup of App.PostContainerView.toggleVisibility()
  // function. I just do not know how to access it from UI bindings
  toggleVisibility: function() {
    this.toggleProperty('parentView.isFormVisible');
  },

  // this method does not observe post comments as a result it won't
  // display additional Add comment link if user does not refresh the page
  isVisible: function() {
    var post = this.get('parentView.content')
    var comments = post.comments || []

    if (comments.length < 4)
      return false

    // NOTE: though following approach is a nice once, FF implements
    // it differently -- just checks number of comments.

    // // return false if comments do not include current user
    // // var exist = post.createdBy.id == currentUser
    // var exist = false
    // comments.forEach(function(comment) {
    //   exist = exist || comment.createdBy.id == currentUser
    // })

    // // If user have not commented this post there is no need to
    // // display additional comment link at the bottom of the post.
    // if (!exist)
    //   return false

    return this.get('parentView.isFormVisible') == false;
  }.property('parentView.isFormVisible'),
})

// Text field to post a comment. Separate view to make it hideable
App.CommentForm = Ember.View.extend({
  // I'd no success to use isVisibleBinding property...
  classNameBindings: 'isVisible visible:invisible',
  body: '',

  isVisible: function() {
    return this.get('parentView.isFormVisible') == true;
  }.property('parentView.isFormVisible'),

  autoFocus: function () {
    if (this.get('parentView.isFormVisible') == true) {
      this.$().hide().show();
      this.$('textarea').focus();
      this.$('textarea').trigger('keyup') // to apply autogrow
    }
  }.observes('parentView.isFormVisible'),

  submitComment: function() {
    if (this.body) {
      // XXX: rather strange bit of code here -- potentially a defect
      var post = this.bindingContext.content || this.bindingContext;
      App.commentsController.createComment(post, this.body)
      this.set('parentView.isFormVisible', false)
      this.set('body', '')
    }
  },

  // XXX: this is a dup of App.PostContainerView.toggleVisibility()
  // function. I just do not know how to access it from UI bindings
  toggleVisibility: function() {
    this.toggleProperty('parentView.isFormVisible');
  }
});

// Create new post text field. Separate view to be able to bind events
App.CreateCommentView = Ember.TextArea.extend(Ember.TargetActionSupport, {
  attributeBindings: ['class'],
  classNames: ['autogrow-short'],
  rows: 1,

  insertNewline: function() {
    this.triggerAction();
  },

  didInsertElement: function() {
    this.$().autogrow();
  }
})

// Separate page for a single post
App.OnePostController = Ember.ObjectController.extend();
App.onePostController = App.OnePostController.create()
App.OnePostView = Ember.View.extend({
  templateName: 'a-post',
  isFormVisible: false,

  toggleVisibility: function(){
    this.toggleProperty('isFormVisible');
  },

  // XXX: kind of dup of App.PostContainerView.unlikePost function
  unlikePost: function() {
    App.postsController.unlikePost(App.onePostController.content.id)
  }
});

App.UserTimelineController = Ember.ObjectController.extend({
  subscribeTo: function(timelineId) {
    $.ajax({
      url: '/v1/timeline/' + timelineId + '/subscribe',
      type: 'post',
      success: function(response) {
        console.log(response)
        App.router.transitionTo('posts')
      }
    })
  },

  unsubscribeTo: function(timelineId) {
    $.ajax({
      url: '/v1/timeline/' + timelineId + '/unsubscribe',
      type: 'post',
      success: function(response) {
        console.log(response)
        App.router.transitionTo('posts')
      }
    })
  }
});
App.userTimelineController = App.UserTimelineController.create()
App.UserTimelineView = Ember.View.extend({
  templateName: 'user-timeline',

  subscribeTo: function() {
    App.userTimelineController.subscribeTo(App.postsController.id)
  },

  unsubscribeTo: function() {
    App.userTimelineController.unsubscribeTo(App.postsController.id)
  }
})

App.Comment = Ember.Object.extend({
  body: null,
  createdAt: null,
  user: null
});

App.User = Ember.Object.extend({
  id: null,
  username: null,
  createdAt: null,
  updatedAt: null,

  subscriptionsLength: function() {
    return this.subscriptions.length
  }.property(),

  subscribersLength: function() {
    return this.subscribers.length
  }.property(),

  subscribedTo: function() {
    var subscribed = this.subscribers.filter(function(subscriber) {
      return subscriber.id == currentUser
    })
    return subscribed.length > 0 ? true : false
  }.property(),

  ownProfile: function() {
    return App.postsController.user.id == currentUser
  }.property()

})

App.CommentsController = Ember.ArrayController.extend({
  // TODO: extract URL to class level
  // TODO: extract data to class/model level
  createComment: function(post, body) {
    var comment = App.Comment.create({ 
      body: body,
      postId: post.id
    });
    
    $.ajax({
      url: '/v1/comments',
      type: 'post',
      data: { body: body, postId: post.id }, // XXX: we've already defined a model above
      context: comment,
      success: function(response) {
        this.setProperties(response);
        // We do not insert comment right now, but wait for a socket event
        // post.comments.pushObject(comment)
      }
    })
    return comment;
  }
})
App.commentsController = App.CommentsController.create()

App.Post = Ember.Object.extend({
  showAllComments: false,

  partial: function() {
    if (this.showAllComments)
      return false
    else
      return this.comments && this.get('comments').length > 3
  }.property('showAllComments', 'comments'),

  removeLike: function(propName, value) {
    var obj = this.get('likes').findProperty(propName, value);
    this.likes.removeObject(obj);
  },

  currentUserLiked: function() {
    var likes = this.get('likes')

    // XXX: we have just tried to render a view but have not recevied
    // anything from the server yet. Ideally we have to wait for this
    if (!likes) return;

    var found = false
    likes.forEach(function(like) {
      if (like.id == currentUser) {
        found = true
        return found;
      }
    })
    return found
  }.property('likes', 'likes.@each'),

  anyLikes: function() {
    var likes = this.get('likes')

    // XXX: we have just tried to render a view but have not recevied
    // anything from the server yet. Ideally we have to wait for this
    if (!likes) return;

    return likes.length > 0
  }.property('likes', 'likes.@each'),

  createdAgo: function() {
    if (this.get('createdAt')) {
      return moment(this.get('createdAt')).fromNow();
    }
  }.property('createdAt'),

  firstComment: function() {
    return this.get('comments')[0]
  }.property('comments'),

  lastComment: function() {
    var comments = this.get('comments')
    return comments[comments.length-1]
  }.property('comments', 'comments.@each'),

  skippedCommentsLength: function() {
    return this.get('comments').length-2 // display first and last comments only
  }.property('comments', 'comments.@each'),

  firstThumbnailSrc: function() {
    if (this.get('attachments') && this.get('attachments')[0]) {
      return this.get('attachments')[0].thumbnail.path;
    } else {
      return false
    }
  }.property('attachments'),

  firstImageSrc: function() {
    if (this.get('attachments') && this.get('attachments')[0]) {
      return this.get('attachments')[0].path;
    } else {
      return false
    }
  }.property('attachments')
});

App.PostsController = Ember.ArrayController.extend(Ember.SortableMixin, App.PaginationHelper, {
  content: [],
  body: '',
  isProgressBarHidden: 'hidden',

  sortProperties: ['updatedAt'],
  sortAscending: false,
  isLoaded: true,

  // XXX: a bit strange having this method here?
  submitPost: function() {
    if (this.body) {
      App.postsController.createPost(this.body);
      this.set('body', '')
    }
  },

  removePost: function(propName, value) {
    var obj = this.findProperty(propName, value);
    this.removeObject(obj);
  },

  // TODO: like model
  likePost: function(postId) {
    $.ajax({
      url: '/v1/posts/' + postId + '/like',
      type: 'post',
      success: function(response) {
        console.log(response)
      }
    })
  },

  // TODO: like model
  unlikePost: function(postId) {
    $.ajax({
      url: '/v1/posts/' + postId + '/unlike',
      type: 'post',
      success: function(response) {
        console.log(response)
      }
    })
  },

  createPost: function(body) {
    // TODO: bind to progress property

    var data = new FormData();
    $.each($('input[type="file"]')[0].files, function(i, file) {
      // TODO: can do this just once outside of the loop
      App.postsController.set('isProgressBarHidden', 'visible')
      data.append('file-'+i, file);
    });
    data.append('body', $('.submitForm textarea')[0].value) // XXX: dirty!

    var xhr = new XMLHttpRequest();
				
    // Progress listerner.
    xhr.upload.addEventListener("progress", function (evt) {

      if (evt.lengthComputable) {
	var percentComplete = Math.round(evt.loaded * 100 / evt.total);
        App.postsController.set('progress', percentComplete)
      } else {
        // unable to compute
      }
    }, false);

    // On finished.
    xhr.addEventListener("load", function (evt) {
      // Clear file field
      var control = $('input[type="file"]')
      control.replaceWith( control.val('').clone( true ) );
      $('.file-input-name').html('')

      // var obj = $.parseJSON(evt.target.responseText);
      // TODO: bind properties
      App.postsController.set('progress', '100')
      App.postsController.set('isProgressBarHidden', 'hidden')
    }, false);

    // On failed.
    xhr.addEventListener("error", function (evt) {
      App.postsController.set('isProgressBarHidden', 'hidden')
    }, false);

    // On cancel.
    xhr.addEventListener("abort", function (evt) {
      App.postsController.set('isProgressBarHidden', 'hidden')
    }, false);

    xhr.open("post", "/v1/posts");
    xhr.send(data);

    // fallback to simple ajax if xhr is not supported
    // $.ajax({
    //   url: '/v1/posts',
    //   type: 'post',
    //   data: data,
    //   cache: false,
    //   contentType: false,
    //   processData: false,      
    //   context: post,
    //   success: function(response) {
    //     this.setProperties(response);
    //     this.attachment = null
    //     this.loading = false
    //     // We do not insert post right now, but wait for a socket event
    //     // App.postsController.insertAt(0, post)
    //   }
    // })

    return this
  },

  didRequestRange: function(pageStart) {
    App.postsController.findAll(pageStart)
  },

  didTimelineChange: function() {
    App.ApplicationController.subscription.unsubscribe()
    this.resetPage()
  }.observes('timeline'),

  findAll: function(pageStart) {
    this.set('isLoaded', false)

    var timeline = this.get('timeline') || ""

    $.ajax({
      url: '/v1/timeline/' + timeline,
      data: { start: pageStart },
      dataType: 'jsonp',
      context: this,
      success: function(response) {
        // TODO: extract to an observer
        App.ApplicationController.subscription.unsubscribe()
        App.ApplicationController.subscription.subscribe('timelineId', response.id)

        this.set('content', [])
        response.posts.forEach(function(attrs) {
          var post = App.Post.create(attrs)
          this.addObject(post)
        }, this)
        this.set('user', App.User.create(response.user))
        this.set('id', response.id)
        this.set('isLoaded', true)
      }
    })
    return this
  },

  findOne: function(postId) {
    var post = App.Post.create({
      id: postId
    });

    $.ajax({
      url: '/v1/posts/' + postId,
      dataType: 'jsonp',
      context: post,
      success: function(response){
        App.ApplicationController.subscription.unsubscribe()
        App.ApplicationController.subscription.subscribe('postId', response.id)
        this.setProperties(response)
      }
    })
    return post;
  }
})
App.postsController = App.PostsController.create()

App.Router = Ember.Router.extend({
  // enableLogging: true,

  root: Ember.Route.extend({
    posts: Ember.Route.extend({
      route: '/',

      showPost: Ember.Route.transitionTo('aPost'),
      showAllPosts: Ember.Route.transitionTo('posts'),
      showUserTimeline: Ember.Route.transitionTo('userTimeline'),
      
      connectOutlets: function(router){ 
        App.postsController.set('timeline', null)
        router.get('applicationController').connectOutlet('posts', App.postsController.findAll());
      }
    }),

    userTimeline: Ember.Route.extend({
      route: '/users/:username',

      showPost: Ember.Route.transitionTo('aPost'),
      showAllPosts: Ember.Route.transitionTo('posts'),
      showUserTimeline: Ember.Route.transitionTo('userTimeline'),

      connectOutlets: function(router, username) {
        App.postsController.set('timeline', username)
        router.get('applicationController').connectOutlet('userTimeline', App.postsController.findAll());
      },

      serialize: function(router, username) {
        return {username: username}
      },

      deserialize: function(router, urlParams) {
        return urlParams.username
      }
    }),

    aPost: Ember.Route.extend({
      route: '/posts/:postId',

      showAllPosts: Ember.Route.transitionTo('posts'),
      showUserTimeline: Ember.Route.transitionTo('userTimeline'),
      
      connectOutlets: function(router, context) {
        // FIXME: obviouly a defect. content should be set automagically
        App.onePostController.set('content', context)
        router.get('applicationController').connectOutlet('onePost', context);
      },

      serialize: function(router, context){
        return {postId: context.get('id')}
      },

      deserialize: function(router, urlParams) {
        return App.postsController.findOne(urlParams.postId);
      }
    })
  })
});

App.initialize();
