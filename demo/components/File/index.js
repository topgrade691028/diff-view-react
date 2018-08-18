import {PureComponent} from 'react';
import {without, sumBy, union, last, uniqueId} from 'lodash';
import {bind} from 'lodash-decorators';
import {Whether, Else} from 'react-whether';
import hash from 'short-hash';
import {Diff, Hunk, expandFromRawCode, getChangeKey} from 'react-diff-view';
import '../../externals/prism.css';
import rawCode from '../../assets/CSSPropertyOperations.raw';
import {
    createFilenameSelector,
    createCanExpandSelector,
    createRenderingHunksSelector,
    createWidgetsSelector
} from '../../selectors';
import HunkInfo from '../HunkInfo';
import UnfoldCollapsed from '../UnfoldCollapsed';
import LargeDiff from '../LargeDiff';
import CommentWidget from '../CommentWidget';
import TokenizeWorker from './Tokenize.worker'; // eslint-disable-line import/default
import './index.css';

/* eslint-disable react/jsx-no-bind, react/no-deprecated */

const rawCodeLines = rawCode.split('\n');

const renderToken = (token, defaultRender, i) => {
    console.log(token); // eslint-disable-line no-console

    return defaultRender(token, i);
};

export default class File extends PureComponent {

    computeFilename = createFilenameSelector();

    computeExpandable = createCanExpandSelector(this.computeFilename);

    computeRenderingHunks = createRenderingHunksSelector(this.computeExpandable);

    computeWidgets = createWidgetsSelector(this.createCommentWidget);

    tokenizeWorker = new TokenizeWorker();

    constructor(props) {
        super(props);

        const {hunks} = props;
        const changeCount = sumBy(hunks, ({changes}) => changes.length);
        const filename = this.computeFilename(this.props);
        const idPrefix = hash(filename);

        this.state = {
            hunks: this.computeRenderingHunks(props),
            renderDiff: changeCount <= 800,
            comments: [],
            writingChanges: [],
            selectedChanges: [],
            workerID: uniqueId(),
            tokens: null,
            gutterEvents: {
                onClick: this.selectChange
            },
            codeEvents: {
                onClick: this.selectChange,
                onDoubleClick: this.addComment
            },
            generateAnchorID(change) {
                return idPrefix + '-' + getChangeKey(change);
            }
        };
    }

    componentDidMount() {
        const {hunks, oldPath} = this.props;
        const {workerID} = this.state;

        this.tokenizeWorker.addEventListener(
            'message',
            ({data: {id, tokens}}) => {
                const {workerID} = this.state;
                if (workerID === id) {
                    this.setState({tokens});
                }
            }
        );

        const canExpand = this.computeExpandable(this.props);
        const data = {
            id: workerID,
            hunks: hunks,
            highlight: oldPath !== 'a',
            language: 'jsx'
        };
        if (canExpand) {
            Object.assign(data, {oldSource: rawCode});
        }
        this.tokenizeWorker.postMessage(data);
    }

    componentWillReceiveProps(nextProps) {
        const currentHunks = this.computeRenderingHunks(this.props);
        const nextHunks = this.computeRenderingHunks(nextProps);

        if (currentHunks !== nextHunks) {
            const patch = {
                hunks: nextHunks,
                comments: {},
                writingChanges: [],
                selectedChanges: []
            };
            this.setState(patch);
        }
    }

    @bind()
    createCommentWidget(changeKey, comments, writing) {
        const onSave = content => this.saveComment(changeKey, content);
        return <CommentWidget comments={comments} writing={writing} onSave={onSave} />;
    }

    @bind()
    addComment(change) {
        const {writingChanges} = this.state;
        const key = getChangeKey(change);

        if (!writingChanges.includes(key)) {
            this.setState({writingChanges: [...writingChanges, key]});
        }
    }

    @bind()
    saveComment(changeKey, content) {
        const {comments, writingChanges} = this.state;
        const postTime = Date.now();
        const previousComments = comments[changeKey] || [];

        const patch = {
            comments: {
                ...comments,
                [changeKey]: [...previousComments, {content, postTime}]
            },
            writingChanges: without(writingChanges, changeKey)
        };
        this.setState(patch);
    }

    @bind()
    selectChange(change) {
        const {selectedChanges} = this.state;
        const key = getChangeKey(change);
        this.setState({selectedChanges: union(selectedChanges, [key])});
    }

    @bind()
    loadCollapsedCode(start, end) {
        const {hunks} = this.state;
        const hunksWithoutStub = last(hunks).content === 'STUB' ? hunks.slice(0, -1) : hunks;
        const newHunks = expandFromRawCode(hunksWithoutStub, rawCodeLines, start, end);
        this.setState({hunks: newHunks});
    }

    render() {
        const {type, additions, deletions, hideGutter, viewType} = this.props;
        const {renderDiff, selectedChanges, hunks, generateAnchorID, tokens, gutterEvents, codeEvents} = this.state;
        const filename = this.computeFilename(this.props);
        const canExpand = this.computeExpandable(this.props);
        const widgets = this.computeWidgets(this.state);

        const renderHunk = (children, hunk, i, hunks) => {
            const previousElement = children[children.length - 1];
            const decorationElement = canExpand
                ? (
                    <UnfoldCollapsed
                        key={'decoration-' + hunk.content}
                        previousHunk={previousElement && previousElement.props.hunk}
                        currentHunk={hunk}
                        rawCodeLines={rawCodeLines}
                        onExpand={this.loadCollapsedCode}
                    />
                )
                : <HunkInfo key={'decoration-' + hunk.content} hunk={hunk} />;
            children.push(decorationElement);

            const hunkElement = (
                <Hunk
                    key={'hunk-' + hunk.content}
                    hunk={hunk}
                    gutterEvents={gutterEvents}
                    codeEvents={codeEvents}
                />
            );
            children.push(hunkElement);

            if (i === hunks.length - 1 && canExpand) {
                const unfoldTailElement = (
                    <UnfoldCollapsed
                        key="decoration-tail"
                        previousHunk={hunk}
                        rawCodeLines={rawCodeLines}
                        onExpand={this.loadCollapsedCode}
                    />
                );
                children.push(unfoldTailElement);
            }

            return children;
        };

        return (
            <article className="diff-file">
                <header className="diff-file-header">
                    <strong className="filename">{filename}</strong>
                    <span className="addition-count">+++ {additions}</span>
                    <span className="deletion-count">--- {deletions}</span>
                </header>
                <main>
                    <Whether matches={renderDiff}>
                        <Diff
                            optimizeSelection
                            gutterType={hideGutter ? 'none' : 'anchor'}
                            diffType={type}
                            widgets={widgets}
                            viewType={viewType}
                            selectedChanges={selectedChanges}
                            generateAnchorID={generateAnchorID}
                            tokens={tokens}
                            renderToken={renderToken}
                        >
                            {hunks.reduce(renderHunk, [])}
                        </Diff>
                        <Else>
                            <LargeDiff onClick={() => this.setState({renderDiff: true})} />
                        </Else>
                    </Whether>
                </main>
            </article>
        );
    }
}