import {
  TypeInfo,
  isInterfaceType,
  Visitor,
  ASTKindToNode,
  getNamedType,
  GraphQLSchema,
  GraphQLInterfaceType,
  FieldNode,
  SelectionNode,
} from "graphql"
import { FragmentMap } from "../../types"
import * as GraphQLAST from "../../utils/ast-nodes"
import { isTypeNameField } from "../../utils/ast-predicates"

interface ITransformArgs {
  schema: GraphQLSchema
  typeInfo: TypeInfo
  nodeReferenceFragmentMap: FragmentMap
}

/**
 * Replaces selection of nodes with references to those nodes.
 *
 * For example (assuming `author` is of type `User` which is a gatsby node):
 * {
 *   author {
 *     firstName
 *     email
 *   }
 * }
 * Is transformed to:
 * {
 *   author {
 *     __typename
 *     id
 *   }
 * }
 */
export function replaceNodeSelectionWithReference(
  args: ITransformArgs
): Visitor<ASTKindToNode> {
  return {
    Field: node => {
      const type = args.typeInfo.getType()
      if (!type || !node.selectionSet?.selections.length) {
        return
      }
      const namedType = getNamedType(type)
      const fragment = args.nodeReferenceFragmentMap.get(namedType.name)
      if (fragment) {
        return { ...node, selectionSet: fragment.selectionSet }
      }
      if (isInterfaceType(namedType)) {
        return transformInterfaceField(args, node, namedType)
      }
      return
    },
  }
}

function transformInterfaceField(
  args: ITransformArgs,
  node: FieldNode,
  type: GraphQLInterfaceType
): FieldNode | undefined {
  const possibleTypes = args.schema.getPossibleTypes(type)
  const nodeImplementations = possibleTypes.some(type =>
    args.nodeReferenceFragmentMap.has(type.name)
  )
  if (!nodeImplementations) {
    return
  }
  // Replace with inline fragment for each implementation
  const selections: SelectionNode[] = possibleTypes.map(type => {
    const nodeReferenceFragment = args.nodeReferenceFragmentMap.get(type.name)
    const inlineFragmentSelections = nodeReferenceFragment
      ? nodeReferenceFragment.selectionSet.selections
      : node.selectionSet?.selections ?? []

    // Filter out __typename field from inline fragments because we add it to the field itself below
    //   (just a prettify thing)
    return GraphQLAST.inlineFragment(
      type.name,
      inlineFragmentSelections.filter(selection => !isTypeNameField(selection))
    )
  })
  return {
    ...node,
    selectionSet: {
      kind: "SelectionSet",
      selections: [GraphQLAST.field(`__typename`), ...selections],
    },
  }
}
