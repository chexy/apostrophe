const _ = require('lodash');
const expressCacheOnDemand = require('express-cache-on-demand')();

module.exports = {
  extend: '@apostrophecms/doc-type',
  cascades: [
    'filters',
    'columns',
    'batchOperations',
    'utilityOperations'
  ],
  options: {
    perPage: 10,
    quickCreate: true,
    previewDraft: true,
    showCreate: true,
    // By default a piece type may be optionally
    // optionally selected by the user as a related document
    // when localizing a document that references it
    // (null means "no opinion"). If set to `true` in your
    // subclass it is selected by default, if set to `false`
    // it is not offered at all
    relatedDocument: null
    // By default there is no public REST API, but you can configure a
    // projection to enable one:
    // publicApiProjection: {
    //   title: 1,
    //   _url: 1,
    // }
  },
  fields: {
    add: {
      slug: {
        type: 'slug',
        label: 'apostrophe:slug',
        following: [ 'title', 'archived' ],
        required: true
      }
    }
  },
  columns(self) {
    return {
      add: {
        title: {
          label: 'apostrophe:title',
          name: 'title',
          component: 'AposCellButton'
        },
        labels: {
          name: 'labels',
          label: '',
          component: 'AposCellLabels'
        },
        updatedAt: {
          name: 'updatedAt',
          label: 'apostrophe:lastEdited',
          component: 'AposCellLastEdited'
        }
      }
    };
  },
  filters: {
    add: {
      visibility: {
        label: 'apostrophe:visibility',
        inputType: 'radio',
        choices: [
          {
            value: 'public',
            label: 'apostrophe:public'
          },
          {
            value: 'loginRequired',
            label: 'apostrophe:loginRequired'
          },
          {
            value: null,
            label: 'apostrophe:any'
          }
        ],
        // TODO: Delete `allowedInChooser` if not used.
        allowedInChooser: false,
        def: null
      },
      archived: {
        label: 'apostrophe:archived',
        inputType: 'radio',
        choices: [
          {
            value: false,
            label: 'apostrophe:live'
          },
          {
            value: true,
            label: 'apostrophe:archived'
          }
        ],
        // TODO: Delete `allowedInChooser` if not used.
        allowedInChooser: false,
        def: false,
        required: true
      }
    }
  },
  utilityOperations(self) {
    return {
      add: {
        new: {
          canEdit: true,
          relationship: true,
          label: {
            key: 'apostrophe:newDocType',
            type: `$t(${self.options.label})`
          },
          eventOptions: {
            event: 'edit',
            type: self.__meta.name
          }
        }
      }
    };
  },
  batchOperations: {
    add: {
      publish: {
        label: 'apostrophe:publish',
        messages: {
          progress: 'Publishing {{ type }}...',
          completed: 'Published {{ count }} {{ type }}.'
        },
        icon: 'earth-icon',
        modalOptions: {
          title: 'apostrophe:publishType',
          description: 'apostrophe:publishingBatchConfirmation',
          confirmationButton: 'apostrophe:publishingBatchConfirmationButton'
        }
      },
      archive: {
        label: 'apostrophe:archive',
        messages: {
          progress: 'Archiving {{ type }}...',
          completed: 'Archived {{ count }} {{ type }}.'
        },
        icon: 'archive-arrow-down-icon',
        if: {
          archived: false
        },
        modalOptions: {
          title: 'apostrophe:archiveType',
          description: 'apostrophe:archivingBatchConfirmation',
          confirmationButton: 'apostrophe:archivingBatchConfirmationButton'
        }
      },
      restore: {
        label: 'apostrophe:restore',
        messages: {
          progress: 'Restoring {{ type }}...',
          completed: 'Restoring {{ count }} {{ type }}.'
        },
        icon: 'archive-arrow-up-icon',
        if: {
          archived: true
        },
        modalOptions: {
          title: 'apostrophe:restoreType',
          description: 'apostrophe:restoreBatchConfirmation',
          confirmationButton: 'apostrophe:restoreBatchConfirmationButton'
        }
      }
    },
    group: {
      more: {
        icon: 'dots-vertical-icon',
        operations: []
      }
    }
  },
  init(self) {
    if (!self.options.name) {
      throw new Error('@apostrophecms/pieces require name option');
    }
    if (!self.options.label) {
      // Englishify it
      self.options.label = _.startCase(self.options.name);
    }
    self.options.pluralLabel = self.options.pluralLabel || self.options.label + 's';

    self.name = self.options.name;
    self.label = self.options.label;
    self.pluralLabel = self.options.pluralLabel;

    self.composeFilters();
    self.composeColumns();
    self.addToAdminBar();
    self.addManagerModal();
    self.addEditorModal();
  },
  restApiRoutes(self) {
    const { enableCacheOnDemand = true } = self.apos
      .modules['@apostrophecms/express'].options;

    return {
      getAll: [
        ...enableCacheOnDemand ? [ expressCacheOnDemand ] : [],
        async (req) => {
          self.publicApiCheck(req);
          const query = self.getRestQuery(req);
          if (!query.get('perPage')) {
            query.perPage(
              self.options.perPage
            );
          }
          const result = {};
          // Also populates totalPages when perPage is present
          const count = await query.toCount();
          if (self.apos.launder.boolean(req.query.count)) {
            return {
              count
            };
          }
          result.pages = query.get('totalPages');
          result.currentPage = query.get('page') || 1;
          result.results = (await query.toArray())
            .map(doc => self.removeForbiddenFields(req, doc));
          if (self.apos.launder.boolean(req.query['render-areas']) === true) {
            await self.apos.area.renderDocsAreas(req, result.results);
          }
          if (query.get('choicesResults')) {
            result.choices = query.get('choicesResults');
          }
          if (query.get('countsResults')) {
            result.counts = query.get('countsResults');
          }

          if (self.options.cache && self.options.cache.api && self.options.cache.api.maxAge) {
            self.setMaxAge(req, self.options.cache.api.maxAge);
          }

          return result;
        }
      ],
      getOne: [
        ...enableCacheOnDemand ? [ expressCacheOnDemand ] : [],
        async (req, _id) => {
          _id = self.inferIdLocaleAndMode(req, _id);
          self.publicApiCheck(req);
          const doc = self.removeForbiddenFields(
            req,
            await self.getRestQuery(req).and({ _id }).toObject()
          );

          if (self.options.cache && self.options.cache.api && self.options.cache.api.maxAge) {
            const { maxAge } = self.options.cache.api;

            if (!self.options.cache.api.etags) {
              self.setMaxAge(req, maxAge);
            } else if (self.checkETag(req, doc, maxAge)) {
              return {};
            }
          }

          if (!doc) {
            throw self.apos.error('notfound');
          }
          if (self.apos.launder.boolean(req.query['render-areas']) === true) {
            await self.apos.area.renderDocsAreas(req, [ doc ]);
          }
          self.apos.attachment.all(doc, { annotate: true });
          return doc;
        }
      ],
      async post(req) {
        self.publicApiCheck(req);
        if (req.body._newInstance) {
          const newInstance = self.newInstance();
          newInstance._previewable = self.addUrlsViaModule && (await self.addUrlsViaModule.readyToAddUrlsToPieces(req, self.name));
          delete newInstance._url;
          return newInstance;
        }
        return await self.convertInsertAndRefresh(req, req.body);
      },
      async put(req, _id) {
        _id = self.inferIdLocaleAndMode(req, _id);
        self.publicApiCheck(req);
        return self.convertUpdateAndRefresh(req, req.body, _id);
      },
      async delete(req, _id) {
        _id = self.inferIdLocaleAndMode(req, _id);
        self.publicApiCheck(req);
        const piece = await self.findOneForEditing(req, {
          _id
        });
        return self.delete(req, piece);
      },
      async patch(req, _id) {
        _id = self.inferIdLocaleAndMode(req, _id);
        self.publicApiCheck(req);
        return self.convertPatchAndRefresh(req, req.body, _id);
      }
    };

  },
  apiRoutes(self) {
    return {
      get: {
        // Returns an object with a `results` array containing all locale names
        // for which the given document has been localized
        ':_id/locales': async (req) => {
          const _id = self.inferIdLocaleAndMode(req, req.params._id);
          return {
            results: await self.apos.doc.getLocales(req, _id)
          };
        }
      },
      post: {
        ':_id/publish': async (req) => {
          const _id = self.inferIdLocaleAndMode(req, req.params._id);
          const draft = await self.findOneForEditing(req.clone({
            mode: 'draft'
          }), {
            aposDocId: _id.split(':')[0]
          });
          if (!draft) {
            throw self.apos.error('notfound');
          }
          if (!draft.aposLocale) {
            // Not subject to draft/publish workflow
            throw self.apos.error('invalid');
          }
          return self.publish(req, draft);
        },
        async publish (req) {
          if (!Array.isArray(req.body._ids)) {
            throw self.apos.error('invalid');
          }

          req.body._ids = req.body._ids.map(_id => {
            return self.inferIdLocaleAndMode(req, _id);
          });

          return self.apos.modules['@apostrophecms/job'].runBatch(
            req,
            req.body._ids,
            async function(req, id) {
              const piece = await self.findOneForEditing(req, { _id: id });

              if (!piece) {
                throw self.apos.error('notfound');
              }

              await self.publish(req, piece);
            }, {
              action: 'publish'
            }
          );
        },
        async archive (req) {
          if (!Array.isArray(req.body._ids)) {
            throw self.apos.error('invalid');
          }

          req.body._ids = req.body._ids.map(_id => {
            return self.inferIdLocaleAndMode(req, _id);
          });

          return self.apos.modules['@apostrophecms/job'].runBatch(
            req,
            req.body._ids,
            async function(req, id) {
              const piece = await self.findOneForEditing(req, { _id: id });

              if (!piece) {
                throw self.apos.error('notfound');
              }

              piece.archived = true;
              await self.update(req, piece);
            }, {
              action: 'archive'
            }
          );
        },
        async restore (req) {
          if (!Array.isArray(req.body._ids)) {
            throw self.apos.error('invalid');
          }

          req.body._ids = req.body._ids.map(_id => {
            return self.inferIdLocaleAndMode(req, _id);
          });

          return self.apos.modules['@apostrophecms/job'].runBatch(
            req,
            req.body._ids,
            async function(req, id) {
              const piece = await self.findOneForEditing(req, { _id: id });

              if (!piece) {
                throw self.apos.error('notfound');
              }

              piece.archived = false;
              await self.update(req, piece);
            }, {
              action: 'restore'
            }
          );
        },
        ':_id/localize': async (req) => {
          const _id = self.inferIdLocaleAndMode(req, req.params._id);
          const draft = await self.findOneForEditing(req.clone({
            mode: 'draft'
          }), {
            aposDocId: _id.split(':')[0]
          });
          if (!draft) {
            throw self.apos.error('notfound');
          }
          if (!draft.aposLocale) {
            // Not subject to draft/publish workflow
            throw self.apos.error('invalid');
          }
          const toLocale = self.apos.i18n.sanitizeLocaleName(req.body.toLocale);
          if ((!toLocale) || (toLocale === req.locale)) {
            throw self.apos.error('invalid');
          }
          const update = self.apos.launder.boolean(req.body.update);
          return self.localize(req, draft, toLocale, {
            update
          });
        },
        ':_id/unpublish': async (req) => {
          const _id = self.apos.i18n.inferIdLocaleAndMode(req, req.params._id);
          const aposDocId = _id.replace(/:.*$/, '');
          const published = await self.findOneForEditing(req.clone({
            mode: 'published'
          }), {
            aposDocId
          });
          if (!published) {
            throw self.apos.error('notfound');
          }
          return self.unpublish(req, published);
        },
        ':_id/submit': async (req) => {
          const _id = self.inferIdLocaleAndMode(req, req.params._id);
          const draft = await self.findOneForEditing(req.clone({
            mode: 'draft'
          }), {
            aposDocId: _id.split(':')[0]
          });
          if (!draft) {
            throw self.apos.error('notfound');
          }
          return self.submit(req, draft);
        },
        ':_id/dismiss-submission': async (req) => {
          const _id = self.inferIdLocaleAndMode(req, req.params._id);
          const draft = await self.findOneForEditing(req.clone({
            mode: 'draft'
          }), {
            aposDocId: _id.split(':')[0]
          });
          if (!draft) {
            throw self.apos.error('notfound');
          }
          return self.dismissSubmission(req, draft);
        },
        ':_id/revert-draft-to-published': async (req) => {
          const _id = self.inferIdLocaleAndMode(req, req.params._id);
          const draft = await self.findOneForEditing(req.clone({
            mode: 'draft'
          }), {
            aposDocId: _id.split(':')[0]
          });
          if (!draft) {
            throw self.apos.error('notfound');
          }
          if (!draft.aposLocale) {
            // Not subject to draft/publish workflow
            throw self.apos.error('invalid');
          }
          return self.revertDraftToPublished(req, draft);
        },
        ':_id/revert-published-to-previous': async (req) => {
          const _id = self.inferIdLocaleAndMode(req, req.params._id);
          const published = await self.findOneForEditing(req.clone({
            mode: 'published'
          }), {
            aposDocId: _id.split(':')[0]
          });
          if (!published) {
            throw self.apos.error('notfound');
          }
          if (!published.aposLocale) {
            // Not subject to draft/publish workflow
            throw self.apos.error('invalid');
          }
          return self.revertPublishedToPrevious(req, published);
        },
        ':_id/share': async (req) => {
          const { _id } = req.params;
          const share = self.apos.launder.boolean(req.body.share);

          if (!_id) {
            throw self.apos.error('invalid');
          }

          const draft = await self.findOneForEditing(req, {
            _id
          });

          if (!draft || draft.aposMode !== 'draft') {
            throw self.apos.error('notfound');
          }

          const sharedDoc = share
            ? await self.share(req, draft)
            : await self.unshare(req, draft);

          return sharedDoc;
        }
      }
    };
  },
  routes(self) {
    return {
      get: {
        // Redirects to the URL of the document in the specified alternate
        // locale. Issues a 404 if the document not found, a 400 if the
        // document has no URL
        ':_id/locale/:toLocale': self.apos.i18n.toLocaleRouteFactory(self)
      }
    };
  },
  handlers(self) {
    return {
      beforeInsert: {
        ensureType(req, piece, options) {
          piece.type = self.name;
        }
      },
      'apostrophe:modulesRegistered': {
        composeBatchOperations() {
          const groupedOperations = Object.entries(self.batchOperations)
            .reduce((acc, [ opName, properties ]) => {
              // Check if there is a required schema field for this batch operation.
              const requiredFieldNotFound = properties.requiredField && !self.schema
                .some((field) => field.name === properties.requiredField);

              if (requiredFieldNotFound) {
                return acc;
              }
              // Find a group for the operation, if there is one.
              const associatedGroup = getAssociatedGroup(opName);
              const currentOperation = {
                action: opName,
                ...properties
              };
              const { action, ...props } = getOperationOrGroup(
                currentOperation,
                associatedGroup,
                acc
              );

              return {
                ...acc,
                [action]: {
                  ...props
                }
              };
            }, {});

          self.batchOperations = Object.entries(groupedOperations)
            .map(([ action, properties ]) => ({
              action,
              ...properties
            }));

          function getOperationOrGroup (currentOp, [ groupName, groupProperties ], acc) {
            if (!groupName) {
              // Operation is not grouped. Return it as it is.
              return currentOp;
            }

            // Return the operation group with the new operation added.
            return {
              name: groupName,
              ...groupProperties,
              operations: [
                ...(acc[groupName] && acc[groupName].operations) || [],
                currentOp
              ]
            };
          }

          // Returns the object entry, e.g., `[groupName, { ...groupProperties }]`
          function getAssociatedGroup (operation) {
            return Object.entries(self.batchOperationsGroups)
              .find(([ _key, { operations } ]) => {
                return operations.includes(operation);
              }) || [];
          }
        },
        composeUtilityOperations() {
          self.utilityOperations = Object.entries(self.utilityOperations || {})
            .map(([ action, properties ]) => ({
              action,
              ...properties
            }));
        }
      },
      '@apostrophecms/search:determineTypes': {
        checkSearchable(types) {
          self.searchDetermineTypes(types);
        }
      }
    };
  },
  methods(self) {
    return {
      // Accepts a doc, a preliminary draft, and the options
      // originally passed to insert(). Default implementation
      // inserts `draft` in the database normally. This method is
      // called only when a draft is being created on the fly
      // for a published document that does not yet have a draft.
      // Apostrophe only has one corresponding draft at a time
      // per published document. `options` is passed on to the
      // insert operation.
      async insertDraftOf(req, doc, draft, options) {
        options = {
          ...options,
          setModified: false
        };
        const inserted = await self.insert(
          req.clone({ mode: 'draft' }),
          draft,
          options
        );
        return inserted;
      },
      // Similar to insertDraftOf, invoked on first publication.
      insertPublishedOf(req, doc, published, options) {
        return self.insert(
          req.clone({ mode: 'published' }),
          published,
          options
        );
      },
      // Returns one editable piece matching the criteria, throws `notfound`
      // if none match
      requireOneForEditing(req, criteria) {
        const piece = self.findForEditing(req, criteria).toObject();
        if (!piece) {
          throw self.apos.error('notfound');
        }
        return piece;
      },
      // Insert a piece. Convenience wrapper for `apos.doc.insert`.
      // Returns the piece. `beforeInsert`, `beforeSave`, `afterInsert`
      // and `afterSave` async events are emitted by this module.
      async insert(req, piece, options) {
        piece.type = self.name;
        return self.apos.doc.insert(req, piece, options);
      },
      //
      // Update a piece. Convenience wrapper for `apos.doc.insert`.
      // Returns the piece. `beforeUpdate`, `beforeSave`, `afterUpdate`
      // and `afterSave` async events are emitted by this module.
      async update(req, piece, options) {
        return self.apos.doc.update(req, piece, options);
      },
      // True delete
      async delete(req, piece, options = {}) {
        return self.apos.doc.delete(req, piece, options);
      },
      composeFilters() {
        self.filters = Object.keys(self.filters).map((key) => ({
          name: key,
          ...self.filters[key],
          inputType: self.filters[key].inputType || 'select'
        }));
        // Add a null choice if not already added or set to `required`
        self.filters.forEach((filter) => {
          if (filter.choices) {
            if (
              !filter.required &&
              filter.choices &&
              !filter.choices.find((choice) => choice.value === null)
            ) {
              filter.def = null;
              filter.choices.push({
                value: null,
                label: 'apostrophe:none'
              });
            }
          } else {
            // Dynamic choices from the REST API, but
            // we need a label for "no opinion"
            filter.nullLabel = 'Choose One';
          }
        });
      },
      composeColumns() {
        self.columns = Object.keys(self.columns).map((key) => ({
          name: key,
          ...self.columns[key]
        }));
      },
      // Enable inclusion of this type in sitewide search results
      searchDetermineTypes(types) {
        if (self.options.searchable !== false) {
          types.push(self.name);
        }
      },
      addToAdminBar() {
        self.apos.adminBar.add(
          `${self.__meta.name}:manager`,
          self.pluralLabel,
          {
            action: 'edit',
            type: self.name
          }
        );
      },
      addManagerModal() {
        self.apos.modal.add(
          `${self.__meta.name}:manager`,
          self.getComponentName('managerModal', 'AposDocsManager'),
          { moduleName: self.__meta.name }
        );
      },
      addEditorModal() {
        self.apos.modal.add(
          `${self.__meta.name}:editor`,
          self.getComponentName('editorModal', 'AposDocEditor'),
          { moduleName: self.__meta.name }
        );
      },
      // Add `._url` properties to the given pieces, if possible.
      async addUrls(req, pieces) {
        if (self.addUrlsViaModule) {
          return self.addUrlsViaModule.addUrlsToPieces(req, pieces);
        }
      },
      // Typically called by a piece-page-type to register itself as the
      // module providing `_url` properties to this type of piece. The addUrls
      // method will invoke the addUrlsToPieces method of that type.
      addUrlsVia(module) {
        self.addUrlsViaModule = module;
      },
      // Implements a simple batch operation like publish or unpublish.
      // Pass `req`, the `name` of a configured batch operation, and
      // and a function that accepts (req, piece, data),
      // and returns a promise to perform the modification on that
      // one piece (including calling `update` if appropriate).
      //
      // `data` is an object containing any schema fields specified
      // for the batch operation. If there is no schema it will be
      // an empty object.
      //
      // Replies immediately to the request with `{ jobId: 'xxxxx' }`.
      // This can then be passed to appropriate browser-side APIs
      // to monitor progress.
      //
      // To avoid RAM issues with very large selections while ensuring
      // that all lifecycle events are fired correctly, the current
      // implementation processes the pieces in series.
      // TODO: restore this method when fully implemented.
      // async batchSimpleRoute(req, name, change) {
      //   const batchOperation = _.find(self.batchOperations, { name: name });
      //   const schema = batchOperation.schema || [];
      //   const data = self.apos.schema.newInstance(schema);

      //   await self.apos.schema.convert(req, schema, req.body, data);
      //   await self.apos.modules['@apostrophecms/job'].runBatch(req, one, {
      //     // TODO: Update with new progress notification config
      //   });
      //   async function one(req, id) {
      //     const piece = self.findForEditing(req, { _id: id }).toObject();
      //     if (!piece) {
      //       throw self.apos.error('notfound');
      //     }
      //     await change(req, piece, data);
      //   }
      // },

      // Accept a piece as untrusted input potentially
      // found in `input` (hint: you can pass `req.body`
      // if your route accepts the piece via POST), using
      // schema-based convert mechanisms.
      //
      // In addition to fields defined in the schema, additional
      // `area` properties are accepted at the root level.
      //
      // Inserts it into the database, fetches it again to get all
      // relationships, and returns the result (note it is an async function).
      //
      // If `input._copyingId` is present, fetches that
      // piece and, if we have permission to view it, copies any schema properties
      // not defined in `input`. `_copyingId` becomes the `copyOfId` property of
      // the doc, which may be watched for in event handlers to detect copies.
      //
      // Only fields that are not undefined in `input` are
      // considered. The rest respect their defaults. To intentionally
      // erase a field's contents use `null` for that input field or another
      // representation appropriate to the type, i.e. an empty string for a string.
      //
      // The module emits the `afterConvert` async event with `(req, input, piece)`
      // before inserting the piece.

      async convertInsertAndRefresh(req, input, options) {
        const piece = self.newInstance();
        const copyingId = self.apos.launder.id(input._copyingId);
        await self.convert(req, input, piece, {
          onlyPresentFields: true,
          copyingId
        });
        await self.emit('afterConvert', req, input, piece);
        await self.insert(req, piece);
        return self.findOneForEditing(
          req,
          { _id: piece._id },
          { attachments: true }
        );
      },

      // Similar to `convertInsertAndRefresh`. Update the piece with the given _id, based on the
      // `input` object (which may be untrusted input such as req.body). Fetch the updated piece to
      // populate all relationships and return it.
      //
      // Any fields not present in `input` are regarded as empty, if permitted (REST PUT semantics).
      // For partial updates use convertPatchAndRefresh. Employs a lock to avoid overwriting the work of
      // concurrent PUT and PATCH calls or getting into race conditions with their side effects.
      //
      // If `_advisoryLock: { tabId: 'xyz', lock: true }` is passed, the operation will begin by obtaining an advisory
      // lock on the document for the given context id, and no other items in the patch will be addressed
      // unless that succeeds. The client must then refresh the lock frequently (by default, at least
      // every 30 seconds) with repeated PATCH requests of the `_advisoryLock` property with the same
      // context id. If `_advisoryLock: { tabId: 'xyz', lock: false }` is passed, the advisory lock will be
      // released *after* addressing other items in the same patch. If `force: true` is added to
      // the `_advisoryLock` object it will always remove any competing advisory lock.
      //
      // `_advisoryLock` is only relevant if you want to ask others not to edit the document while you are
      // editing it in a modal or similar.

      async convertUpdateAndRefresh(req, input, _id) {
        return self.apos.lock.withLock(`@apostrophecms/${_id}`, async () => {
          const piece = await self.findOneForEditing(req, { _id });
          if (!piece) {
            throw self.apos.error('notfound');
          }
          if (!piece._edit) {
            throw self.apos.error('forbidden');
          }
          let tabId = null;
          let lock = false;
          let force = false;
          if (input._advisoryLock && typeof input._advisoryLock === 'object') {
            tabId = self.apos.launder.string(input._advisoryLock.tabId);
            lock = self.apos.launder.boolean(input._advisoryLock.lock);
            force = self.apos.launder.boolean(input._advisoryLock.force);
          }
          if (tabId && lock) {
            await self.apos.doc.lock(req, piece, tabId, {
              force
            });
          }
          await self.convert(req, input, piece);
          await self.emit('afterConvert', req, input, piece);
          await self.update(req, piece);
          if (tabId && !lock) {
            await self.apos.doc.unlock(req, piece, tabId);
          }
          return self.findOneForEditing(req, { _id }, { attachments: true });
        });
      },

      // Similar to `convertUpdateAndRefresh`. Patch the piece with the given _id, based on the
      // `input` object (which may be untrusted input such as req.body). Fetch the updated piece to
      // populate all relationships and return it. Employs a lock to avoid overwriting the work of
      // simultaneous PUT and PATCH calls or getting into race conditions with their side effects.
      // However if you plan to submit many patches over a period of time while editing you may also
      // want to use the advisory lock mechanism.
      //
      // If `_advisoryLock: { tabId: 'xyz', lock: true }` is passed, the operation will begin by obtaining an advisory
      // lock on the document for the given context id, and no other items in the patch will be addressed
      // unless that succeeds. The client must then refresh the lock frequently (by default, at least
      // every 30 seconds) with repeated PATCH requests of the `_advisoryLock` property with the same
      // context id. If `_advisoryLock: { tabId: 'xyz', lock: false }` is passed, the advisory lock will be
      // released *after* addressing other items in the same patch. If `force: true` is added to
      // the `_advisoryLock` object it will always remove any competing advisory lock.
      //
      // `_advisoryLock` is only relevant if you plan to make ongoing edits over a period of time
      // and wish to avoid conflict with other users. You do not need it for one-time patches.
      //
      // If `input._patches` is an array of patches to the same document, this method
      // will iterate over those patches as if each were `input`, applying all of them
      // within a single lock and without redundant network operations. This greatly
      // improves the performance of saving all changes to a document at once after
      // accumulating a number of changes in patch form on the front end.
      //
      // If `input._publish` launders to a truthy boolean and the type is subject to draft/publish
      // workflow, it is automatically published at the end of the patch operation.
      //
      // As an optimization, and to prevent unnecessary updates of `updatedAt`, no calls
      // to `self.update()` are made when only `_advisoryLock` is present in `input` or
      // it contains no properties at all.

      async convertPatchAndRefresh(req, input, _id) {
        const keys = Object.keys(input);
        let possiblePatchedFields;
        if (input._advisoryLock && keys.length === 1) {
          possiblePatchedFields = false;
        } else if (keys.length === 0) {
          possiblePatchedFields = false;
        } else {
          possiblePatchedFields = true;
        }
        return self.apos.lock.withLock(`@apostrophecms/${_id}`, async () => {
          const piece = await self.findOneForEditing(req, { _id });
          let result;
          if (!piece) {
            throw self.apos.error('notfound');
          }
          const patches = Array.isArray(input._patches)
            ? input._patches
            : [ input ];
          // Conventional for loop so we can handle the last one specially
          for (let i = 0; i < patches.length; i++) {
            const input = patches[i];
            let tabId = null;
            let lock = false;
            let force = false;
            if (
              input._advisoryLock &&
              typeof input._advisoryLock === 'object'
            ) {
              tabId = self.apos.launder.string(input._advisoryLock.tabId);
              lock = self.apos.launder.boolean(input._advisoryLock.lock);
              force = self.apos.launder.boolean(input._advisoryLock.force);
            }
            if (tabId && lock) {
              await self.apos.doc.lock(req, piece, tabId, {
                force
              });
            }
            if (possiblePatchedFields) {
              await self.applyPatch(req, piece, input, {
                force: self.apos.launder.boolean(input._advisory)
              });
            }
            if (i === patches.length - 1) {
              if (possiblePatchedFields) {
                await self.update(req, piece);
              }
              result = self.findOneForEditing(
                req,
                { _id },
                { attachments: true }
              );
            }
            if (tabId && !lock) {
              await self.apos.doc.unlock(req, piece, tabId);
            }
          }
          if (!result) {
            // Edge case: empty `_patches` array. Don't be a pain,
            // return the document as-is
            return self.findOneForEditing(req, { _id }, { attachments: true });
          }
          if (self.apos.launder.boolean(input._publish)) {
            if (self.options.localized && !self.options.autopublish) {
              if (piece.aposLocale.includes(':draft')) {
                await self.publish(req, piece, {});
              }
            }
          }
          return result;
        });
      },
      // Apply a single patch to the given piece without saving. An implementation detail of
      // convertPatchAndRefresh, also used by the undo mechanism to simulate patches.
      async applyPatch(req, piece, input) {
        self.apos.schema.implementPatchOperators(input, piece);
        const schema = self.apos.schema.subsetSchemaForPatch(
          self.allowedSchema(req),
          input
        );
        await self.apos.schema.convert(req, schema, input, piece);
        await self.emit('afterConvert', req, input, piece);
      },
      // Generate a sample piece of this type. The `i` counter
      // is used to distinguish it from other samples. Useful
      // for things like testing pagination, see the
      // `your-piece-type:generate` task.
      generate(i) {
        const piece = self.newInstance();
        piece.title = 'Generated #' + (i + 1);
        return piece;
      },
      getRestQuery(req) {
        const query = self.find(req).attachments(true);
        query.applyBuildersSafely(req.query);
        if (!self.apos.permission.can(req, 'view-draft')) {
          if (!self.options.publicApiProjection) {
            // Shouldn't be needed thanks to publicApiCheck, but be sure
            query.and({
              _id: null
            });
          } else if (!query.state.project) {
            query.project({
              ...self.options.publicApiProjection,
              cacheInvalidatedAt: 1
            });
          }
        }
        return query;
      },
      // Throws a `notfound` exception if a public API projection is
      // not specified and the user does not have the `view-draft` permission,
      // which all roles capable of editing the site at all will have. This is needed because
      // although all API calls check permissions specifically where appropriate,
      // we also want to flunk all public access to REST APIs if not specifically configured.
      publicApiCheck(req) {
        if (!self.options.publicApiProjection) {
          if (!self.apos.permission.can(req, 'view-draft')) {
            throw self.apos.error('notfound');
          }
        }
      },
      // If the piece does not yet have a slug, add one based on the
      // title; throw an error if there is no title
      ensureSlug(piece) {
        if (!piece.slug || piece.slug === 'none') {
          if (piece.title) {
            piece.slug = self.apos.util.slugify(piece.title);
          } else if (piece.slug !== 'none') {
            throw self.apos.error(
              'invalid',
              'Document has neither slug nor title, giving up'
            );
          }
        }
      },
      async flushInsertsAndDeletes(inserts, deletes, { force = false }) {
        if (inserts.length > 100 || (force && inserts.length)) {
          await self.apos.doc.db.insertMany(inserts);
          inserts.splice(0);
        }

        if (deletes.length > 100 || (force && deletes.length)) {
          await self.apos.doc.db.deleteMany({ _id: { $in: deletes } });
          deletes.splice(0);
        }
      }
    };
  },
  extendMethods(self) {
    return {
      getBrowserData(_super, req) {
        const browserOptions = _super(req);
        // Options specific to pieces and their manage modal
        browserOptions.filters = self.filters;
        browserOptions.columns = self.columns;
        browserOptions.batchOperations = self.batchOperations;
        browserOptions.utilityOperations = self.utilityOperations;
        browserOptions.insertViaUpload = self.options.insertViaUpload;
        browserOptions.quickCreate = !self.options.singleton && self.options.quickCreate && self.apos.permission.can(req, 'edit', self.name, 'draft');
        browserOptions.singleton = self.options.singleton;
        browserOptions.showCreate = !self.options.singleton && self.options.showCreate;
        browserOptions.showDismissSubmission = self.options.showDismissSubmission;
        browserOptions.showArchive = self.options.showArchive;
        browserOptions.showDiscardDraft = self.options.showDiscardDraft;
        browserOptions.canEdit = self.apos.permission.can(req, 'edit', self.name, 'draft');
        browserOptions.canPublish = self.apos.permission.can(req, 'edit', self.name, 'publish');
        _.defaults(browserOptions, {
          components: {}
        });
        _.defaults(browserOptions.components, {
          editorModal: 'AposDocEditor',
          managerModal: 'AposDocsManager'
        });

        return browserOptions;
      },
      find(_super, req, criteria, projection) {
        return _super(req, criteria, projection).defaultSort(self.options.sort || { updatedAt: -1 });
      }
    };
  },
  tasks(self) {
    return (self.options.editRole === 'admin') ? {} : {
      generate: {
        usage: 'Invoke this task to generate sample docs of this type. Use the --total option to control how many are added to the database.\nYou can remove them all later with the --remove option.',
        async task(argv) {
          if (argv.remove) {
            return remove();
          } else {
            return generate();
          }
          async function generate() {
            const total = argv.total || 10;
            const req = self.apos.task.getReq();
            for (let i = 0; i < total; i++) {
              const piece = self.generate(i);
              piece.aposSampleData = true;
              await self.insert(req, piece);
            }
          }
          async function remove() {
            return self.apos.doc.db.deleteMany({
              type: self.name,
              aposSampleData: true
            });
          }
        }
      },

      localize: {
        usage: 'Add draft version documents for each locale when a module has the "localized" option.' +
        '\nExample: node app [moduleName]:localize',
        async task() {
          if (!self.options.localized) {
            throw new Error('Localized option not set to true, so the module cannot be localized.');
          }

          console.log('Adding drafts and locales to documents');

          const locales = Object.keys(self.apos.i18n.locales);
          const lastPublishedAt = new Date();
          const inserts = [];
          const deletes = [];

          await self.apos.migration.eachDoc({ type: self.name }, async doc => {
            if (doc.aposDocId && !doc._id.endsWith('published') && !doc._id.endsWith('draft')) {
              deletes.push(doc._id);

              for (const locale of locales) {
                const newDraft = {
                  ...doc,
                  aposLocale: `${locale}:draft`,
                  aposMode: 'draft',
                  aposDocId: doc._id,
                  _id: `${doc.aposDocId}:${locale}:draft`
                };
                const newPublished = {
                  ...doc,
                  aposLocale: `${locale}:published`,
                  aposMode: 'published',
                  aposDocId: doc._id,
                  _id: `${doc.aposDocId}:${locale}:published`,
                  lastPublishedAt
                };
                inserts.push(newDraft);
                inserts.push(newPublished);

                await self.flushInsertsAndDeletes(inserts, deletes);
              }
            }
          });

          await self.flushInsertsAndDeletes(inserts, deletes, { force: true });
          await self.apos.attachment.recomputeAllDocReferences();

          console.log(`Done localizing module ${self.name}`);
        }
      },

      unlocalize: {
        usage: 'Remove duplicate documents when a module has not "localized" and "autopublish" anymore.' +
        '\nOptions are:' +
        '\n- locale: if not set, it is the project\'s default locale' +
        '\n- mode: by default, published' +
        '\nExample: node app [moduleName]:unlocalize --mode=published --locale=en',
        async task(argv) {
          if (self.options.localized) {
            throw new Error('Localized option not set to false, so the module cannot be unlocalized.');
          }

          const locale = argv.locale || self.apos.i18n.defaultLocale;
          const mode = argv.mode || 'published';
          const inserts = [];
          const deletes = [];

          console.log(`Removing duplicated documents and updating ${mode} ones`);

          await self.apos.migration.eachDoc({ type: self.name }, async doc => {
            deletes.push(doc._id);

            if (doc.aposDocId && doc.aposLocale === `${locale}:${mode}` && doc.aposMode === mode) {
              const newDoc = {
                ...doc,
                aposLocale: undefined,
                aposMode: undefined,
                _id: doc.aposDocId
              };
              inserts.push(newDoc);

              await self.flushInsertsAndDeletes(inserts, deletes);
            }
          });

          await self.flushInsertsAndDeletes(inserts, deletes, { force: true });
          await self.apos.attachment.recomputeAllDocReferences();

          console.log(`Done unlocalizing module ${self.name}`);
        }
      },

      touch: {
        usage: 'Invoke this task to touch (update without any change) all docs of this type.',
        async task(argv) {
          const req = self.apos.task.getAdminReq();
          let errCount = 0;
          let count = 0;
          let cursor;
          const criteria = self.options.autopublish
            ? { aposMode: 'draft' }
            : {};

          try {
            // We have 30 minutes (by default) for each iteration.
            // https://www.mongodb.com/docs/manual/reference/method/cursor.noCursorTimeout/#session-idle-timeout-overrides-nocursortimeout
            cursor = (await self.find(req, criteria)
              .locale(null)
              .limit(0)
              .toMongo())
              .addCursorFlag('noCursorTimeout', true);

            for await (const doc of cursor) {
              try {
                await self.update(req, doc);
                count++;
              } catch (e) {
                errCount++;
                self.apos.util.error(e);
              }
            }
          } catch (error) {
            self.apos.util.error(error);
          } finally {
            if (cursor) {
              await cursor.close();
            }
          }
          console.log(`Touched ${count} doc(s) with ${errCount} error(s)`);

          // Return, useful for tests and internal API's
          // It's in effect only when invoked via apos.task.invoke().
          return {
            touched: count,
            errors: errCount
          };
        }
      }
    };
  }
};
