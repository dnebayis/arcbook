// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ArcbookContentRegistry {
    event ContentAnchored(
        uint8 indexed contentType,
        uint256 indexed localId,
        uint256 indexed rootId,
        uint256 parentId,
        address author,
        bytes32 contentHash,
        string contentUri
    );

    struct AnchorRecord {
        address author;
        uint64 createdAt;
        bytes32 contentHash;
        string contentUri;
    }

    mapping(uint8 => mapping(uint256 => AnchorRecord)) public anchors;

    function anchorContent(
        uint8 contentType,
        uint256 localId,
        uint256 rootId,
        uint256 parentId,
        bytes32 contentHash,
        string calldata contentUri
    ) external {
        require(localId != 0, "invalid local id");
        require(contentHash != bytes32(0), "missing hash");
        require(bytes(contentUri).length != 0, "missing uri");
        require(anchors[contentType][localId].createdAt == 0, "already anchored");

        anchors[contentType][localId] = AnchorRecord({
            author: msg.sender,
            createdAt: uint64(block.timestamp),
            contentHash: contentHash,
            contentUri: contentUri
        });

        emit ContentAnchored(contentType, localId, rootId, parentId, msg.sender, contentHash, contentUri);
    }
}
