import {InboxList, type InboxProps} from "./window.tsx";
export function InboxGlance(props: InboxProps) {
	return <InboxList {...props} glance />;
}
